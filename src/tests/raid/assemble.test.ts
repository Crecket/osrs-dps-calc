import { describe, expect, test } from '@jest/globals';
import { BulkSetup } from '@/bulk/types';
import { Candidate } from '@/raid/lib/candidates';
import {
  assembleLoadout, AssembleInput, NO_SETUP_SECONDS, THRALL_DPS,
} from '@/raid/lib/assemble';

const cand = (phaseKey: string, itemIds: number[], dps: number): Candidate => ({
  phaseKey, style: 'ranged', dps, itemIds, setup: { id: `${phaseKey}:${itemIds.join('+')}` } as BulkSetup,
});

const phases = (n: number, hp = 1000) => Array.from({ length: n }, (_, i) => ({ key: `p${i}`, hp }));

const input = (over: Partial<AssembleInput>): AssembleInput => ({
  phases: phases(1),
  candidates: [],
  priceOf: () => 0,
  budget: 0,
  requiredIds: [],
  maxItems: 100,
  extraDps: 0,
  ...over,
});

const B = 1e9;

describe('assembleLoadout', () => {
  test('owned items are free', () => {
    const plan = assembleLoadout(input({ candidates: [cand('p0', [1, 2, 3], 10)] }));
    expect(plan.itemIds.sort()).toEqual([1, 2, 3]);
    expect(plan.cost).toBe(0);
    expect(plan.totalSeconds).toBeCloseTo(100);
  });

  test('a phase with no setup costs the fixed penalty', () => {
    const plan = assembleLoadout(input({}));
    expect(plan.totalSeconds).toBe(NO_SETUP_SECONDS);
    expect(plan.picks[0].candidate).toBeNull();
  });

  test('spends where it saves most time', () => {
    const prices: Record<number, number> = { 1: 3.2 * B, 2: 1 * B, 3: 2 * B };
    const plan = assembleLoadout(input({
      phases: phases(3),
      priceOf: (id) => prices[id] ?? 0,
      budget: 4 * B,
      candidates: [
        cand('p0', [9], 5), cand('p1', [9], 5), cand('p2', [9], 5),
        cand('p0', [1], 5.5),
        cand('p1', [2], 8), cand('p2', [3], 8),
      ],
    }));
    expect(plan.itemIds).toContain(2);
    expect(plan.itemIds).toContain(3);
    expect(plan.itemIds).not.toContain(1);
  });

  test('maxes out with a huge budget', () => {
    const prices: Record<number, number> = { 1: 3 * B, 2: 2 * B, 3: 1 * B };
    const plan = assembleLoadout(input({
      phases: phases(2),
      priceOf: (id) => prices[id] ?? 0,
      budget: 20 * B,
      candidates: [cand('p0', [1], 20), cand('p0', [3], 10), cand('p1', [2], 20), cand('p1', [3], 10)],
    }));
    expect(plan.picks.map((p) => p.candidate?.itemIds[0])).toEqual([1, 2]);
    expect(plan.cost).toBeLessThan(20 * B);
  });

  test('required items are kept even over budget', () => {
    const plan = assembleLoadout(input({ priceOf: () => 5 * B, budget: 1 * B, requiredIds: [7] }));
    expect(plan.itemIds).toContain(7);
    expect(plan.overBudget).toBe(true);
  });

  test('thralls add flat dps', () => {
    expect(assembleLoadout(input({ phases: phases(1, 600), extraDps: THRALL_DPS })).totalSeconds).toBe(NO_SETUP_SECONDS);
    const plan = assembleLoadout(input({ phases: phases(1, 600), extraDps: THRALL_DPS, candidates: [cand('p0', [1], 6)] }));
    expect(plan.totalSeconds).toBeCloseTo(600 / (6 + THRALL_DPS));
  });

  test('respects maxItems', () => {
    const plan = assembleLoadout(input({
      phases: phases(2), maxItems: 4, candidates: [cand('p0', [1, 2, 3], 10), cand('p1', [4, 5, 6], 10)],
    }));
    expect(plan.itemIds).toHaveLength(3);
  });

  test('second best beats one huge item', () => {
    // H (2b) is best on every phase and both greedy passes buy it first; five 0.6b items, each better on one phase,
    // only fit when H isn't bought
    const prices: Record<number, number> = {
      100: 2 * B, 1: 0.6 * B, 2: 0.6 * B, 3: 0.6 * B, 4: 0.6 * B, 5: 0.6 * B,
    };
    const candidates = [
      ...[0, 1, 2, 3, 4].map((i) => cand(`p${i}`, [100], 10)),
      ...[0, 1, 2, 3, 4].map((i) => cand(`p${i}`, [i + 1], 11)),
    ];
    const plan = assembleLoadout(input({
      phases: phases(5), candidates, priceOf: (id) => prices[id] ?? 0, budget: 3 * B,
    }));
    expect(plan.itemIds).not.toContain(100);
    expect(plan.totalSeconds).toBeCloseTo((5 * 1000) / 11);
  });

  test('item that helps many bosses beats a per-boss favourite', () => {
    const plan = assembleLoadout(input({
      phases: phases(4),
      priceOf: () => B,
      budget: B,
      candidates: [cand('p0', [2], 20), ...[0, 1, 2, 3].map((i) => cand(`p${i}`, [1], 9))],
    }));
    expect(plan.itemIds).toEqual([1]);
  });

  test('unused items are dropped', () => {
    // the free item 1 is bought first by the cost-aware pass, then made useless by item 2
    const prices: Record<number, number> = { 2: B };
    const plan = assembleLoadout(input({
      phases: phases(2),
      priceOf: (id) => prices[id] ?? 0,
      budget: B,
      candidates: [cand('p0', [1], 5), cand('p0', [2], 10), cand('p1', [2], 10)],
    }));
    expect(plan.itemIds).toEqual([2]);
  });

  test('main is the setup used for the most time', () => {
    const plan = assembleLoadout(input({
      phases: phases(3),
      candidates: [cand('p0', [1], 10), cand('p1', [2], 10), cand('p2', [2], 10)],
    }));
    expect(plan.main?.itemIds).toEqual([2]);
  });

  test('a forced key item never pushes the plan over budget', () => {
    const prices: Record<number, number> = { 7: 50, 1: 80 };
    const plan = assembleLoadout(input({
      phases: phases(1),
      priceOf: (id) => prices[id] ?? 0,
      budget: 100,
      requiredIds: [7],
      candidates: [cand('p0', [9], 5), cand('p0', [1], 10)],
    }));
    expect(plan.cost).toBeLessThanOrEqual(100);
    expect(plan.itemIds).not.toContain(1);
  });

  test('stays fast', () => {
    let seed = 1;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const candidates = Array.from({ length: 300 }, () => {
      const n = 3 + Math.floor(rand() * 6);
      const ids = [...new Set(Array.from({ length: n }, () => 1 + Math.floor(rand() * 40)))];
      return cand(`p${Math.floor(rand() * 9)}`, ids, 5 + rand() * 10);
    });
    const prices = Array.from({ length: 41 }, () => Math.floor(rand() * 2 * B));
    const start = Date.now();
    assembleLoadout(input({
      phases: phases(9), candidates, priceOf: (id) => prices[id], budget: 4 * B, maxItems: 23,
    }));
    expect(Date.now() - start).toBeLessThan(1000);
  });

  describe('phases split by style', () => {
    const melee = (phaseKey: string, itemIds: number[], dps: number): Candidate => ({ ...cand(phaseKey, itemIds, dps), style: 'slash' });
    const split = [{ key: 'p0', hp: 1000, parts: [{ styles: ['ranged' as const], share: 0.5 }, { styles: ['stab' as const, 'slash' as const, 'crush' as const], share: 0.5 }] }];

    test('each part is done by a setup of its styles', () => {
      const plan = assembleLoadout(input({ phases: split, candidates: [cand('p0', [1], 5), melee('p0', [2], 10)] }));
      // 500 hp at 5 dps + 500 hp at 10 dps
      expect(plan.totalSeconds).toBeCloseTo(150);
      expect(plan.itemIds.sort()).toEqual([1, 2]);
      expect(plan.picks.map((p) => p.key)).toEqual(['p0', 'p0']);
    });

    test('a part with no setup of its styles costs the penalty share', () => {
      const plan = assembleLoadout(input({ phases: split, candidates: [melee('p0', [2], 10)] }));
      expect(plan.totalSeconds).toBeCloseTo(50 + NO_SETUP_SECONDS / 2);
    });

    test('a part without styles takes any setup', () => {
      const anyPart = [{ key: 'p0', hp: 1000, parts: [{ styles: ['ranged' as const], share: 0.5 }, { share: 0.5 }] }];
      const plan = assembleLoadout(input({ phases: anyPart, candidates: [cand('p0', [1], 5), melee('p0', [2], 10)] }));
      expect(plan.totalSeconds).toBeCloseTo(150);
    });
  });
});
