import { describe, expect, test } from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import { bestPool, WeaponJob, weaponJobs } from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import {
  BestRunDeps, JOBS_PER_WEAPON, referenceJobs, runBestSetup, unionEffects,
} from '@/best/lib/run';
import { BestPayload, BestResult, handleBestChunk } from '@/best/worker/protocol';
import { computeRow, prepareMonster } from '@/bulk/lib/compute';
import { BulkMonster } from '@/bulk/types';
import {
  BestInputs, BestStyle, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS,
} from '@/best/types';
import { getTestMonster } from '@/tests/utils/TestUtils';

const pool = bestPool();

const inputs = (styles: BestStyle[], topN = 3): BestInputs => ({
  skills: {
    atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
  },
  unlocks: DEFAULT_UNLOCKS,
  conditions: DEFAULT_CONDITIONS,
  potions: {},
  styles,
  topN,
});

const vorkath: BulkMonster = { id: 'vorkath', monster: prepareMonster(getTestMonster('Vorkath', 'Post-quest')) };

// small enough to keep the real search fast
const opts = { topK: 2, cap: 500 };

const twoHanded = (job: WeaponJob) => availableEquipment.find((e) => e.id === job.weaponId)!.isTwoHanded;

/** A cheap made-up DPS per job, so that jobs of one weapon differ too. */
const fakeDps = (job: WeaponJob) => {
  const key = JSON.stringify([job.weaponId, job.combatStyle.name, job.ammoId, job.spellName, job.dartId]);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100003;
  return 1 + hash / 1000;
};

/** Search answers without the engine: effects by handedness, one fake result per job. */
const synthetic = (p: BestPayload): BestResult => {
  if (p.kind === 'effects') return { kind: 'effects', effects: twoHanded(p.job) ? { head: [1, 2], neck: [5] } : { head: [2, 3], shield: [9] } };
  return {
    kind: 'search',
    results: p.jobs.map((job) => ({
      job, gear: {}, dps: fakeDps(job), approximate: p.mode === 'descent',
    })),
  };
};

/** Deps that compute in this thread, recording every search payload. */
const fakeDeps = (handle: (p: BestPayload) => BestResult = handleBestChunk) => {
  const calls: BestPayload[][] = [];
  const answers: BestResult[][] = [];
  let searchCancels = 0;
  const deps: BestRunDeps = {
    search: {
      run: (payloads, onProgress, count = () => 1) => {
        calls.push(payloads);
        const results = payloads.map(handle);
        answers.push(results);
        // like TaskPool: done counts results, one per payload
        onProgress({ results, done: results.length, total: payloads.reduce((n, p) => n + count(p), 0) });
        return Promise.resolve(results);
      },
      cancel: () => { searchCancels += 1; },
    },
    rows: {
      run: (setups, monsters, onProgress) => {
        const rows = setups.flatMap((s) => monsters.map((m) => computeRow(s, m)));
        onProgress({ rows, done: rows.length, total: rows.length });
        return Promise.resolve(rows);
      },
      cancel: () => {},
    },
  };
  return {
    deps, calls, answers, searchCancels: () => searchCancels,
  };
};

describe('referenceJobs', () => {
  test('picks a one-handed and a two-handed job when both exist', () => {
    const refs = referenceJobs(weaponJobs(pool, 'slash'));
    expect(refs.map(twoHanded)).toEqual([false, true]);
  });

  test('picks only the kind that exists', () => {
    const refs = referenceJobs(weaponJobs(pool, 'slash').filter(twoHanded));
    expect(refs.map(twoHanded)).toEqual([true]);
  });
});

describe('unionEffects', () => {
  test('merges per slot without duplicates', () => {
    expect(unionEffects([{ head: [1, 2], neck: [5] }, { head: [2, 3], shield: [9] }])).toEqual({
      head: [1, 2, 3], neck: [5], shield: [9],
    });
  });
});

describe('runBestSetup', () => {
  test('one outcome per style, top setups sorted by computeRow DPS', async () => {
    const { deps } = fakeDeps();
    const progress: [number, number][] = [];
    const outcomes = await runBestSetup(inputs(['slash']), vorkath, deps, (done, total) => progress.push([done, total]), opts);

    expect(outcomes.map((o) => o.style)).toEqual(['slash']);
    const [o] = outcomes;
    expect(o.message).toBeNull();
    expect(o.setups.length).toBeGreaterThan(0);
    expect(o.setups.length).toBeLessThanOrEqual(3);
    expect(o.rows.length).toBe(o.setups.length);
    o.setups.forEach((setup, i) => {
      expect(setup.id).toBe(`best-slash-${i}`);
      expect(o.rows[i].setupId).toBe(setup.id);
      expect(o.rows[i].dps).toBe(computeRow(setup, vorkath).dps);
      if (i > 0) expect(o.rows[i].dps).toBeLessThanOrEqual(o.rows[i - 1].dps);
      const { equipment, style } = setup.player;
      expect(setup.name).toBe(`${equipment.weapon!.name} (${style.name})`);
    });
    // every setup is built on the style's base player
    expect(o.setups[0].player.prayers).toEqual(basePlayer(inputs(['slash']), 'slash').prayers);

    const [done, total] = progress[progress.length - 1];
    expect(done).toBe(total);
    expect(progress.every(([d, t]) => d <= t)).toBe(true);
  }, 30000);

  test('effects first, then descent over all jobs, then exhaustive over the top weapons', async () => {
    const { deps, calls } = fakeDeps(synthetic);
    const outcomes = await runBestSetup(inputs(['ranged']), vorkath, deps, () => {}, { topK: 3 });
    const jobs = weaponJobs(pool, 'ranged');

    expect(calls.length).toBe(3);
    const [effects, descent, exhaustive] = calls;

    // one-handed and two-handed reference jobs, their effects merged
    expect(effects.map((p) => (p.kind === 'effects' ? twoHanded(p.job) : null))).toEqual([false, true]);
    descent.forEach((p) => {
      if (p.kind !== 'search') throw new Error('expected a search payload');
      expect(p.mode).toBe('descent');
      expect(p.effects).toEqual({ head: [2, 3, 1], shield: [9], neck: [5] });
      expect(p.jobs.length).toBeLessThanOrEqual(8);
    });
    expect(descent.flatMap((p) => (p.kind === 'search' ? p.jobs : []))).toEqual(jobs);

    // the top 3 weapons by their best job, and each weapon's top JOBS_PER_WEAPON jobs
    const byWeapon = new Map<number, WeaponJob[]>();
    jobs.forEach((j) => byWeapon.set(j.weaponId, [...(byWeapon.get(j.weaponId) ?? []), j]));
    const best = (ws: WeaponJob[]) => Math.max(...ws.map(fakeDps));
    const expected = [...byWeapon.values()].sort((a, b) => best(b) - best(a)).slice(0, 3)
      .flatMap((ws) => [...ws].sort((a, b) => fakeDps(b) - fakeDps(a)).slice(0, JOBS_PER_WEAPON));
    // the test needs weapons with more jobs than are kept
    expect([...byWeapon.values()].some((ws) => ws.length > JOBS_PER_WEAPON)).toBe(true);

    const exhaustiveJobs = exhaustive.flatMap((p) => {
      if (p.kind !== 'search') throw new Error('expected a search payload');
      expect(p.mode).toBe('exhaustive');
      // the shared effects too: only the WEAPON_LINKED items are re-tested per job
      expect(p.effects).toEqual({ head: [2, 3, 1], shield: [9], neck: [5] });
      return p.jobs;
    });
    expect(new Set(exhaustiveJobs)).toEqual(new Set(expected));
    expect(exhaustiveJobs.length).toBe(expected.length);
    expect(new Set(exhaustiveJobs.map((j) => j.weaponId)).size).toBe(3);

    // only exhaustive results are shown
    expect(outcomes[0].approximate).toBe(false);
  });

  test('a style with only 0-DPS results has no setups and a message', async () => {
    const zero = (p: BestPayload): BestResult => (p.kind === 'effects'
      ? { kind: 'effects', effects: {} }
      : {
        kind: 'search',
        results: p.jobs.map((job) => ({
          job, gear: {}, dps: 0, approximate: false,
        })),
      });
    const { deps, calls } = fakeDeps(zero);
    const progress: [number, number][] = [];
    // the fake reports progress for the empty exhaustive phase too, with total 0
    const outcomes = await runBestSetup(inputs(['magic']), vorkath, deps, (done, total) => progress.push([done, total]), opts);

    expect(outcomes).toEqual([{
      style: 'magic', setups: [], rows: [], approximate: false, message: 'No usable magic setup found',
    }]);
    // nothing worth an exhaustive search
    expect(calls.flat().some((p) => p.kind === 'search' && p.mode === 'exhaustive')).toBe(false);
    expect(progress.every(([d, t]) => Number.isFinite(d) && d <= t)).toBe(true);
  });

  test('a new run cancels the previous one', async () => {
    const { deps, searchCancels } = fakeDeps(synthetic);
    const first = runBestSetup(inputs(['slash'], 1), vorkath, deps, () => {}, opts);
    const second = runBestSetup(inputs(['slash'], 1), vorkath, deps, () => {}, opts);

    await expect(first).rejects.toThrow('cancelled');
    expect(searchCancels()).toBeGreaterThan(0);
    const outcomes = await second;
    expect(outcomes[0].setups.length).toBe(1);
  });
});
