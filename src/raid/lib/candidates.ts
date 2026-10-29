/**
 * Candidate setups for a raid: the best setup search run per route phase at a few price tiers. Main thread only
 * (basePlayer imports '@/state').
 */
import { getCanonicalItemId } from '@/lib/Equipment';
import { EquipmentPiece, Player } from '@/types/Player';
import { BestPhase, BestRunDeps, runBestSetup } from '@/best/lib/run';
import { buildPlayer, Gear } from '@/best/lib/search';
import { GearSlot } from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import { hashKey } from '@/best/lib/resultCache';
import { BestInputs, BestStyle } from '@/best/types';
import { BulkSetup, GEAR_SLOT_ORDER } from '@/bulk/types';
import { RoutePhase } from '@/raid/types';
import { SearchCache, StoredCandidate } from '@/raid/lib/searchCache';

export interface Candidate {
  phaseKey: string;
  style: BestStyle;
  setup: BulkSetup;
  dps: number;
  /** Canonical ids of every worn item, ammo included */
  itemIds: number[];
}

export interface RaidProgress {
  /** Searches finished in this run, cached ones not counted */
  search: number;
  /** Searches this run has to do */
  searches: number;
  phaseLabel: string;
  /** The current search's own progress */
  inner: { done: number; total: number; phase: BestPhase } | null;
  cached: number;
}

/** Weapons searched per style and phase */
export const RAID_TOP_K = 3;
/** Searches run at once */
export const RAID_PARALLEL = 3;

/**
 * Exclusion lists for the price tiers (the budget, a quarter of it, owned and free items only): the pool's items that
 * cost more than the tier, except required ones, plus `excluded`. Sorted, duplicates removed.
 */
export const tierExclusions = (
  budget: number,
  priceOf: (id: number) => number,
  excluded: number[],
  pool: EquipmentPiece[],
  requiredIds: number[] = [],
): number[][] => {
  const seen = new Set<string>();
  // required items are bought anyway, so every tier may use them
  const required = new Set(requiredIds);
  return [budget, budget / 4, 0].flatMap((cap) => {
    const above = pool.filter((e) => !required.has(e.id) && priceOf(e.id) > cap).map((e) => e.id);
    const ids = [...new Set([...excluded, ...above])].sort((a, b) => a - b);
    const key = ids.join(',');
    if (seen.has(key)) return [];
    seen.add(key);
    return [ids];
  });
};

const SLOTS = GEAR_SLOT_ORDER.filter((s): s is GearSlot => s !== 'weapon');

export const toStored = (setup: BulkSetup, style: BestStyle, dps: number): StoredCandidate => {
  const { player } = setup;
  const weapon = player.equipment.weapon!;
  const gear: Gear = {};
  SLOTS.forEach((slot) => {
    gear[slot] = player.equipment[slot]?.id ?? null;
  });
  return {
    style,
    dps,
    gear,
    job: {
      style,
      weaponId: weapon.id,
      combatStyle: player.style,
      // ammo travels in the gear
      ammoId: null,
      spellName: player.spell?.name ?? null,
      dartId: (weapon.itemVars?.blowpipeDartId as number | undefined) ?? null,
    },
  };
};

/** The stored setup dressed on `base`; null when one of its items is no longer in the data */
export const fromStored = (s: StoredCandidate, phaseKey: string, base: Player): Candidate | null => {
  try {
    const player = buildPlayer(base, s.job, s.gear);
    const worn = GEAR_SLOT_ORDER.map((slot) => player.equipment[slot]).filter((e): e is EquipmentPiece => !!e);
    return {
      phaseKey,
      style: s.style,
      dps: s.dps,
      setup: { id: `${phaseKey}-${s.job.weaponId}`, name: player.equipment.weapon!.name, player },
      itemIds: [...new Set(worn.map((e) => getCanonicalItemId(e.id)))],
    };
  } catch {
    return null;
  }
};

const searchInputs = (base: BestInputs, tier: number[]): BestInputs => ({ ...base, excludedItemIds: tier });

export const searchKey = (phase: RoutePhase, inputs: BestInputs): string => hashKey(JSON.stringify({ monster: phase.monster.monster, inputs }));

/** How many of the searches for these phases and tiers aren't cached yet */
export const missingSearches = (phases: RoutePhase[], base: BestInputs, tiers: number[][], cache: SearchCache): number => phases
  .reduce((n, phase) => n + tiers.filter((tier) => !cache.has(searchKey(phase, searchInputs(base, tier)))).length, 0);

/**
 * Every search's setups with DPS for each phase × tier, from the cache or by running the best setup search.
 * `RAID_PARALLEL` searches run at once on the shared pools, so workers one search leaves idle (its effect check, its
 * last few combinations) pick up another's work. Candidates come back in phase × tier order.
 */
export const raidCandidates = async (
  phases: RoutePhase[],
  base: BestInputs,
  tiers: number[][],
  deps: BestRunDeps,
  onProgress: (p: RaidProgress) => void,
  cache: SearchCache,
  search: typeof runBestSetup = runBestSetup,
): Promise<Candidate[]> => {
  const searches = missingSearches(phases, base, tiers, cache);
  const cached = phases.length * tiers.length - searches;
  const players = new Map<BestStyle, Player>();
  const playerFor = (style: BestStyle) => {
    if (!players.has(style)) players.set(style, basePlayer(base, style));
    return players.get(style)!;
  };

  const jobs = phases.flatMap((phase) => tiers.map((tier) => {
    const inputs = searchInputs(base, tier);
    return { phase, inputs, key: searchKey(phase, inputs) };
  }));
  const stored: StoredCandidate[][] = jobs.map((j) => cache.get(j.key) ?? []);
  const todo = jobs.map((j, i) => i).filter((i) => !cache.has(jobs[i].key));

  let done = 0;
  const active = new Map<number, string>();
  // the latest progress any running search reported
  const latest: { inner: RaidProgress['inner'] } = { inner: null };
  const report = () => onProgress({
    search: done, searches, phaseLabel: [...new Set(active.values())].join(', '), inner: latest.inner, cached,
  });

  // each lane takes the next search until none are left
  let next = 0;
  const lane = async () => {
    while (next < todo.length) {
      const i = todo[next];
      next += 1;
      const { phase, inputs, key } = jobs[i];
      active.set(i, `${phase.boss.name}${phase.boss.phases.length > 1 ? ` — ${phase.phase.label}` : ''}`);
      report();
      // eslint-disable-next-line no-await-in-loop
      const outcomes = await search(inputs, phase.monster, deps, (d, total, p) => {
        latest.inner = { done: d, total, phase: p };
        report();
      }, { topK: RAID_TOP_K, concurrent: true });
      stored[i] = outcomes.flatMap((o) => o.setups.map((setup, n) => ({ setup, dps: o.rows[n]?.dps ?? 0, style: o.style })))
        .filter((x) => x.dps > 0)
        .map((x) => toStored(x.setup, x.style, x.dps));
      cache.set(key, stored[i]);
      active.delete(i);
      done += 1;
      report();
    }
  };
  await Promise.all(Array.from({ length: Math.min(RAID_PARALLEL, todo.length) }, lane));

  return jobs.flatMap((j, i) => stored[i]
    .map((s) => fromStored(s, j.phase.phase.key, playerFor(s.style)))
    .filter((c): c is Candidate => c !== null));
};
