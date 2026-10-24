/**
 * Runs the best setup search for every chosen style. Main thread only (basePlayer imports '@/state'); worker code
 * must not import this file.
 */
import { availableEquipment } from '@/lib/Equipment';
import { EquipmentPiece, Player } from '@/types/Player';
import { basePlayer } from '@/best/lib/basePlayer';
import {
  bestPool, GearSlot, WeaponJob, weaponJobs,
} from '@/best/lib/candidates';
import { buildPlayer, SearchResult } from '@/best/lib/search';
import { BestPayload, BestResult, EffectIds } from '@/best/worker/protocol';
import { TaskPool } from '@/bulk/worker/TaskPool';
import { BulkPool } from '@/bulk/worker/BulkPool';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';
import { BestInputs, BestStyle } from '@/best/types';

export interface StyleOutcome {
  style: BestStyle;
  setups: BulkSetup[];
  /** rows[i] is the computeRow result of setups[i] */
  rows: BulkRow[];
  /** True when a shown setup comes from coordinate descent, which may miss the best setup */
  approximate: boolean;
  /** Why there are no setups, e.g. 'No usable magic setup found' */
  message: string | null;
}

export interface BestRunDeps {
  search: Pick<TaskPool<BestPayload, BestResult>, 'run' | 'cancel'>;
  rows: Pick<BulkPool, 'run' | 'cancel'>;
}

/** Weapons that get the exhaustive search, per style, by their best descent DPS. */
export const TOP_K_WEAPONS = 6;
/** Jobs (stances, ammo, spells) per selected weapon that get the exhaustive search. */
export const JOBS_PER_WEAPON = 1;
/** Combinations above which a job's exhaustive search falls back to descent. */
export const COMBINATION_CAP = 20000;
// descent is quick per job, so its jobs travel in batches; exhaustive jobs go one per payload to spread over the workers
const DESCENT_JOBS_PER_PAYLOAD = 8;

let pool: EquipmentPiece[] | null = null;
let itemsById: Map<number, EquipmentPiece> | null = null;
const getPool = () => {
  if (!pool) pool = bestPool();
  return pool;
};
const itemById = (id: number) => {
  if (!itemsById) itemsById = new Map(availableEquipment.map((e) => [e.id, e]));
  return itemsById.get(id)!;
};

// each call takes a new token; a run whose token is no longer current is cancelled
let currentRun = 0;
let runningDeps: BestRunDeps | null = null;

const chunk = <T>(items: T[], size: number): T[][] => Array.from(
  { length: Math.ceil(items.length / size) },
  (_, i) => items.slice(i * size, (i + 1) * size),
);

const jobKey = (job: WeaponJob) => JSON.stringify([job.weaponId, job.combatStyle.name, job.ammoId, job.spellName, job.dartId]);

/**
 * The style's jobs split by handedness, one-handed first, for the shared effect test: each group's reference job is the one with the best baseline DPS (shield effects need a one-hander). Empty groups are left out.
 */
export const referenceGroups = (jobs: WeaponJob[]): WeaponJob[][] => [false, true]
  .map((twoHanded) => jobs.filter((j) => itemById(j.weaponId).isTwoHanded === twoHanded))
  .filter((group) => group.length > 0);

/** Per-slot union of effect ids, first seen first. */
export const unionEffects = (all: EffectIds[]): EffectIds => {
  const union: EffectIds = {};
  all.forEach((effects) => (Object.entries(effects) as [GearSlot, number[]][]).forEach(([slot, ids]) => {
    union[slot] = [...new Set([...(union[slot] ?? []), ...ids])];
  }));
  return union;
};

const setupName = (job: WeaponJob) => {
  let name = `${itemById(job.weaponId).name} (${job.combatStyle.name})`;
  if (job.spellName !== null) name += ` + ${job.spellName}`;
  if (job.ammoId !== null) name += ` + ${itemById(job.ammoId).name}`;
  if (job.dartId !== null) name += ` + ${itemById(job.dartId).name}`;
  return name;
};

/**
 * The jobs for the exhaustive search: the `topK` weapons with the best job DPS, and of each its `JOBS_PER_WEAPON` best
 * jobs, so that one weapon's stances or ammo don't crowd out other weapons. Jobs with no DPS are left out. Of equal DPS
 * the earlier job or weapon stays first.
 */
const topWeaponJobs = (jobs: WeaponJob[], dps: (job: WeaponJob) => number, topK: number): WeaponJob[] => {
  const byWeapon = new Map<number, WeaponJob[]>();
  // stable sort: best job first, so each weapon's list is sorted and the weapons come in order of their best job
  jobs.filter((job) => dps(job) > 0).sort((a, b) => dps(b) - dps(a))
    .forEach((job) => byWeapon.set(job.weaponId, [...(byWeapon.get(job.weaponId) ?? []), job]));
  return [...byWeapon.values()].slice(0, topK).flatMap((weaponJobList) => weaponJobList.slice(0, JOBS_PER_WEAPON));
};

interface StylePlan {
  style: BestStyle;
  base: Player;
  jobs: WeaponJob[];
}

/**
 * The top `inputs.topN` setups per style against `monster`. Per style: (0) the effect activity test for the style's reference jobs (the best damaging one-handed and two-handed job by baseline DPS), shared as the style's effects; (1) coordinate descent over every weapon job with those effects; (2) an exhaustive search, with a full per-job activity test, of the best descent jobs of the `topK` best weapons. The shown setups are the best distinct phase-2 results, with their numbers from
 * computeRow. Each phase runs every style's payloads in one pool run. A new call cancels the previous one, whose promise rejects with Error('cancelled').
 */
export const runBestSetup = async (
  inputs: BestInputs,
  monster: BulkMonster,
  deps: BestRunDeps,
  onProgress: (done: number, total: number) => void,
  opts: { topK?: number; cap?: number } = {},
): Promise<StyleOutcome[]> => {
  if (runningDeps) {
    runningDeps.search.cancel();
    runningDeps.rows.cancel();
  }
  currentRun += 1;
  const token = currentRun;
  runningDeps = deps;
  const check = () => {
    if (token !== currentRun) throw new Error('cancelled');
  };
  const topK = opts.topK ?? TOP_K_WEAPONS;
  const cap = opts.cap ?? COMBINATION_CAP;
  const { topN } = inputs;
  const target = monster.monster;

  try {
    const plans: StylePlan[] = inputs.styles.map((style) => ({
      style, base: basePlayer(inputs, style), jobs: weaponJobs(getPool(), style, target),
    }));

    // progress counts jobs: one per effect test, one per searched job and phase
    const units = (p: BestPayload) => (p.kind === 'effects' ? 1 : p.jobs.length);
    let done = 0;
    let total = 0;
    const searchRun = async (payloads: BestPayload[]) => {
      const before = done;
      const phaseUnits = payloads.reduce((n, p) => n + units(p), 0);
      // the pool counts finished payloads (one result each); scale that to jobs
      const results = await deps.search.run(payloads, (p) => {
        if (token === currentRun && p.total > 0) onProgress(before + Math.round((p.done / p.total) * phaseUnits), total);
      });
      check();
      done = before + phaseUnits;
      return results;
    };

    // phase 0: shared effects per style, from the best damaging one-handed and two-handed jobs
    const refs = plans.map((plan) => referenceGroups(plan.jobs));
    const effectPayloads = plans.flatMap((plan, i) => refs[i].map((jobs): BestPayload => ({
      kind: 'effects', base: plan.base, monster: target, jobs,
    })));
    total = effectPayloads.length + plans.reduce((n, plan) => n + plan.jobs.length + Math.min(topK * JOBS_PER_WEAPON, plan.jobs.length), 0);
    const effectResults = await searchRun(effectPayloads);
    let at = 0;
    const styleEffectIds = refs.map((r) => {
      const res = effectResults.slice(at, at + r.length);
      at += r.length;
      return unionEffects(res.map((e) => (e.kind === 'effects' ? e.effects : {})));
    });

    // phase 1: descent over every job
    const descentChunks = plans.map((plan) => chunk(plan.jobs, DESCENT_JOBS_PER_PAYLOAD));
    const descentResults = await searchRun(plans.flatMap((plan, i) => descentChunks[i].map((jobs): BestPayload => ({
      kind: 'search', base: plan.base, monster: target, jobs, mode: 'descent', topN, cap, effects: styleEffectIds[i],
    }))));
    at = 0;
    const topJobs = plans.map((plan, i) => {
      const results = descentResults.slice(at, at + descentChunks[i].length)
        .flatMap((r) => (r.kind === 'search' ? r.results : []));
      at += descentChunks[i].length;
      const bestDps = new Map<string, number>();
      results.forEach((r) => bestDps.set(jobKey(r.job), Math.max(r.dps, bestDps.get(jobKey(r.job)) ?? 0)));
      return topWeaponJobs(plan.jobs, (job) => bestDps.get(jobKey(job)) ?? 0, topK);
    });
    // jobs with no damage skip phase 2
    total = done + topJobs.reduce((n, jobs) => n + jobs.length, 0);

    // phase 2: exhaustive over the top weapons' top jobs, each with its own full activity test: the shared effects come from another weapon and can miss what matters for this one (an effect that needs the weapon to hurt the monster)
    const exhaustiveResults = await searchRun(plans.flatMap((plan, i) => topJobs[i].map((job): BestPayload => ({
      kind: 'search', base: plan.base, monster: target, jobs: [job], mode: 'exhaustive', topN, cap,
    }))));
    // phase 2 may have been empty
    onProgress(done, total);
    at = 0;
    const picked: SearchResult[][] = plans.map((_, i) => {
      const results = exhaustiveResults.slice(at, at + topJobs[i].length)
        .flatMap((r) => (r.kind === 'search' ? r.results : []));
      at += topJobs[i].length;
      const seen = new Set<string>();
      return results.filter((r) => r.dps > 0)
        .sort((a, b) => b.dps - a.dps)
        .filter((r) => {
          const key = jobKey(r.job) + JSON.stringify(r.gear);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .slice(0, topN);
    });

    const setups = plans.map((plan, i) => picked[i].map((r, n): BulkSetup => ({
      id: `best-${plan.style}-${n}`,
      name: setupName(r.job),
      player: buildPlayer(plan.base, r.job, r.gear),
    })));
    const rows = await deps.rows.run(setups.flat(), [monster], () => {});
    check();
    const rowById = new Map(rows.map((r) => [r.setupId, r]));

    return plans.map((plan, i): StyleOutcome => {
      // the search's DPS should match computeRow; sort by the shown numbers anyway, and number the setups in that order
      const pairs = setups[i].map((setup) => ({ setup, row: rowById.get(setup.id)! }))
        .sort((a, b) => b.row.dps - a.row.dps)
        .map(({ setup, row }, n) => {
          const id = `best-${plan.style}-${n}`;
          return { setup: { ...setup, id }, row: { ...row, setupId: id } };
        });
      return {
        style: plan.style,
        setups: pairs.map((p) => p.setup),
        rows: pairs.map((p) => p.row),
        approximate: picked[i].some((r) => r.approximate),
        message: pairs.length === 0 ? `No usable ${plan.style} setup found` : null,
      };
    });
  } finally {
    if (token === currentRun) runningDeps = null;
  }
};
