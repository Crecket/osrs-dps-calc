import { describe, expect, test } from '@jest/globals';
import { BulkSetup } from '@/bulk/types';
import { Candidate } from '@/raid/lib/candidates';
import { mainSetup, orderedItems, PhasePick } from '@/raid/lib/assemble';

const cand = (phaseKey: string, itemIds: number[], dps: number): Candidate => ({
  phaseKey, style: 'ranged', dps, itemIds, setup: { id: `${phaseKey}:${itemIds.join('+')}` } as BulkSetup,
});

const pick = (c: Candidate | null, seconds: number): PhasePick => ({
  key: c?.phaseKey ?? 'none', hp: 1000, candidate: c, seconds,
});

describe('orderedItems', () => {
  test('items in order of first use, then the required ones, each once', () => {
    expect(orderedItems([pick(cand('a', [3, 1], 10), 100), pick(cand('b', [1, 2], 10), 100), pick(null, 600)], [9, 2]))
      .toEqual([3, 1, 2, 9]);
  });
});

describe('mainSetup', () => {
  test('the setup used for the most time, adding up the phases that share its items', () => {
    const ranged = [cand('a', [1, 2], 10), cand('b', [2, 1], 10)];
    const melee = cand('c', [3], 10);
    expect(mainSetup([pick(ranged[0], 100), pick(ranged[1], 100), pick(melee, 150)])).toBe(ranged[0]);
  });

  test('none without picks', () => {
    expect(mainSetup([pick(null, 600)])).toBeNull();
  });
});
