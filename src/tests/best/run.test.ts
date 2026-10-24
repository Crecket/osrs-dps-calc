import { describe, expect, test } from '@jest/globals';
import { bestPool, weaponJobs } from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import { runBestSetup, BestRunDeps } from '@/best/lib/run';
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

// small enough to keep the tests fast
const opts = { topK: 3, cap: 2000 };

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

describe('runBestSetup', () => {
  test('one outcome per style, top setups sorted by computeRow DPS', async () => {
    const { deps } = fakeDeps();
    const progress: [number, number][] = [];
    const outcomes = await runBestSetup(inputs(['crush', 'slash']), vorkath, deps, (done, total) => progress.push([done, total]), opts);

    expect(outcomes.map((o) => o.style)).toEqual(['crush', 'slash']);
    outcomes.forEach((o) => {
      expect(o.message).toBeNull();
      expect(o.setups.length).toBeGreaterThan(0);
      expect(o.setups.length).toBeLessThanOrEqual(3);
      expect(o.rows.length).toBe(o.setups.length);
      o.setups.forEach((setup, i) => {
        expect(setup.id).toBe(`best-${o.style}-${i}`);
        expect(o.rows[i].setupId).toBe(setup.id);
        expect(o.rows[i].dps).toBe(computeRow(setup, vorkath).dps);
        if (i > 0) expect(o.rows[i].dps).toBeLessThanOrEqual(o.rows[i - 1].dps);
        const { equipment, style, spell } = setup.player;
        expect(setup.name.startsWith(`${equipment.weapon!.name} (${style.name})`)).toBe(true);
        if (spell) expect(setup.name).toContain(` + ${spell.name}`);
      });
    });
    const [done, total] = progress[progress.length - 1];
    expect(done).toBe(total);
    expect(progress.every(([d, t]) => d <= t)).toBe(true);
  });

  test('effects first, then descent over all jobs, then exhaustive over the top jobs', async () => {
    const { deps, calls, answers } = fakeDeps();
    const outcomes = await runBestSetup(inputs(['slash']), vorkath, deps, () => {}, opts);
    const jobs = weaponJobs(pool, 'slash');

    expect(calls.length).toBe(3);
    const [effects, descent, exhaustive] = calls;

    expect(effects.length).toBeGreaterThanOrEqual(1);
    expect(effects.length).toBeLessThanOrEqual(2);
    expect(effects.every((p) => p.kind === 'effects')).toBe(true);

    const descentPayloads = descent.filter((p) => p.kind === 'search');
    expect(descentPayloads.length).toBe(descent.length);
    descentPayloads.forEach((p) => {
      if (p.kind !== 'search') return;
      expect(p.mode).toBe('descent');
      expect(p.effects).toBeDefined();
      expect(p.jobs.length).toBeLessThanOrEqual(8);
    });
    const descentJobs = descentPayloads.flatMap((p) => (p.kind === 'search' ? p.jobs : []));
    expect(descentJobs).toEqual(jobs);

    // phase-1 best DPS per job, from the descent answers
    const best = descentPayloads.flatMap((p, i) => {
      const res = answers[1][i];
      if (p.kind !== 'search' || res.kind !== 'search') return [];
      return p.jobs.map((job) => Math.max(0, ...res.results.filter((r) => r.job === job).map((r) => r.dps)));
    });
    const topJobs = jobs.map((job, i) => ({ job, dps: best[i] }))
      .filter((j) => j.dps > 0)
      .sort((a, b) => b.dps - a.dps)
      .slice(0, opts.topK)
      .map((j) => j.job);

    const exhaustiveJobs = exhaustive.flatMap((p) => {
      if (p.kind !== 'search') throw new Error('expected a search payload');
      expect(p.mode).toBe('exhaustive');
      expect(p.effects).toBeUndefined();
      return p.jobs;
    });
    expect(new Set(exhaustiveJobs.map((j) => JSON.stringify(j)))).toEqual(new Set(topJobs.map((j) => JSON.stringify(j))));
    expect(exhaustiveJobs.length).toBe(opts.topK);

    // every result is built on the style's base player
    expect(outcomes[0].setups[0].player.prayers).toEqual(basePlayer(inputs(['slash']), 'slash').prayers);
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
    const outcomes = await runBestSetup(inputs(['magic']), vorkath, deps, () => {}, opts);

    expect(outcomes).toEqual([{
      style: 'magic', setups: [], rows: [], approximate: false, message: 'No usable magic setup found',
    }]);
    // nothing worth an exhaustive search
    expect(calls.flat().some((p) => p.kind === 'search' && p.mode === 'exhaustive')).toBe(false);
  });

  test('a new run cancels the previous one', async () => {
    const { deps, searchCancels } = fakeDeps();
    const first = runBestSetup(inputs(['slash'], 1), vorkath, deps, () => {}, opts);
    const second = runBestSetup(inputs(['slash'], 1), vorkath, deps, () => {}, opts);

    await expect(first).rejects.toThrow('cancelled');
    expect(searchCancels()).toBeGreaterThan(0);
    const outcomes = await second;
    expect(outcomes[0].setups.length).toBe(1);
  });
});
