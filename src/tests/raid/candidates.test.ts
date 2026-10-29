import {
  beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentPiece } from '@/types/Player';
import type { StyleOutcome } from '@/best/lib/run';
import { buildPlayer } from '@/best/lib/search';
import { basePlayer } from '@/best/lib/basePlayer';
import { BestInputs, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS } from '@/best/types';
import { BulkRow } from '@/bulk/types';
import { raidById } from '@/raid/raids';
import { routePhases } from '@/raid/lib/route';
import {
  fromStored, missingSearches, raidCandidates, RaidProgress, tierExclusions, toStored,
} from '@/raid/lib/candidates';
import { SearchCache } from '@/raid/lib/searchCache';

const mockRun = jest.fn<(...args: unknown[]) => Promise<StyleOutcome[]>>();
const search = ((...args: unknown[]) => mockRun(...args)) as never;

const inputs: BestInputs = {
  skills: {
    atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
  },
  unlocks: DEFAULT_UNLOCKS,
  conditions: DEFAULT_CONDITIONS,
  potions: {},
  styles: ['ranged'],
  topN: 1,
};

const item = (id: number) => availableEquipment.find((e) => e.id === id)!;
const tbow = item(20997);
const rapid = getCombatStylesForCategory(tbow.category).find((s) => s.stance === 'Rapid')!;

// a Twisted bow setup with dragon arrows and a Masori mask, 10 DPS
const outcome = (): StyleOutcome[] => {
  const player = buildPlayer(basePlayer(inputs, 'ranged'), {
    style: 'ranged', weaponId: 20997, combatStyle: rapid, ammoId: 11212, spellName: null, dartId: null,
  }, { head: 27235 });
  return [{
    style: 'ranged',
    setups: [{ id: 'best-ranged-0', name: 'Twisted bow', player }],
    rows: [{ setupId: 'best-ranged-0', dps: 10 } as BulkRow],
    approximate: false,
    message: null,
    variants: {},
  }];
};

const memoryStorage = () => {
  const data = new Map<string, unknown>();
  return {
    data,
    getItem: async <T>(key: string) => (data.get(key) as T) ?? null,
    setItem: async <T>(key: string, value: T) => {
      data.set(key, JSON.parse(JSON.stringify(value)));
      return value;
    },
  };
};

const fa = raidById('fractured-archive');
const phases = routePhases(fa, fa.defaultRoute, {}, []).slice(0, 2);
const deps = { search: { run: jest.fn(), cancel: jest.fn() }, rows: { run: jest.fn(), cancel: jest.fn() } } as never;

beforeEach(() => {
  mockRun.mockReset();
  mockRun.mockImplementation(async () => outcome());
});

describe('tierExclusions', () => {
  const a = { id: 1 } as EquipmentPiece;
  const b = { id: 2 } as EquipmentPiece;
  const c = { id: 3 } as EquipmentPiece;
  const prices: Record<number, number> = { 1: 0, 2: 100, 3: 1000 };

  test('tiers drop items above each cap', () => {
    expect(tierExclusions(400, (id) => prices[id], [], [a, b, c])).toEqual([[3], [2, 3]]);
  });

  test('excluded items are in every tier', () => {
    expect(tierExclusions(400, (id) => prices[id], [1], [a, b, c])).toEqual([[1, 3], [1, 2, 3]]);
  });

  test('owned items never excluded', () => {
    expect(tierExclusions(400, (id) => (id === 3 ? 0 : prices[id]), [], [a, b, c])).toEqual([[], [2]]);
  });
});

describe('stored candidates', () => {
  test('stored candidate round trip', () => {
    const [o] = outcome();
    const stored = toStored(o.setups[0], 'ranged', 10);
    const back = fromStored(stored, 'bork:0', basePlayer(inputs, 'ranged'))!;
    expect(back.itemIds.sort()).toEqual([11212, 20997, 27235].sort());
    expect(back.setup.player.style.stance).toBe('Rapid');
    expect(back.setup.player.spell).toBeNull();
    expect(back.dps).toBe(10);
    expect(back.phaseKey).toBe('bork:0');
  });

  test('an unknown item drops the stored candidate', () => {
    const [o] = outcome();
    const stored = toStored(o.setups[0], 'ranged', 10);
    expect(fromStored({ ...stored, gear: { head: 999999999 } }, 'bork:0', basePlayer(inputs, 'ranged'))).toBeNull();
  });
});

describe('raidCandidates', () => {
  test('candidates come from every phase and tier', async () => {
    const cache = new SearchCache(memoryStorage());
    const progress: RaidProgress[] = [];
    const result = await raidCandidates(phases, inputs, [[1], [1, 2]], deps, (p) => progress.push(p), cache, search);
    expect(mockRun).toHaveBeenCalledTimes(4);
    expect(result.map((c) => c.phaseKey).sort()).toEqual(['guardian:0', 'guardian:0', 'guardian:1', 'guardian:1']);
    expect(progress[progress.length - 1]).toMatchObject({ search: 4, searches: 4, cached: 0 });
  });

  test('second run with the same exclusions hits the cache', async () => {
    const cache = new SearchCache(memoryStorage());
    await raidCandidates(phases, inputs, [[1]], deps, () => {}, cache, search);
    mockRun.mockClear();
    expect(missingSearches(phases, inputs, [[1]], cache)).toBe(0);
    const again = await raidCandidates(phases, inputs, [[1]], deps, () => {}, cache, search);
    expect(mockRun).not.toHaveBeenCalled();
    expect(again).toHaveLength(2);
  });

  test('a new exclusion list runs only its own searches', async () => {
    const cache = new SearchCache(memoryStorage());
    await raidCandidates(phases, inputs, [[1]], deps, () => {}, cache, search);
    expect(missingSearches(phases, inputs, [[1], [1, 2]], cache)).toBe(2);
  });
});

describe('SearchCache', () => {
  const entry = () => toStored(outcome()[0].setups[0], 'ranged', 10);

  test('search cache survives a reload', async () => {
    const storage = memoryStorage();
    const cache = new SearchCache(storage);
    await cache.load();
    cache.set('k', [entry()]);
    await cache.flush();
    const reloaded = new SearchCache(storage);
    await reloaded.load();
    expect(reloaded.get('k')).toHaveLength(1);
  });

  test('version change clears the cache', async () => {
    const storage = memoryStorage();
    await storage.setItem('dps-raid-searches', { version: 'old', entries: [['k', [entry()]]] });
    const cache = new SearchCache(storage);
    await cache.load();
    expect(cache.get('k')).toBeUndefined();
  });

  test('trims to the limit, dropping the least recently used', async () => {
    const cache = new SearchCache(memoryStorage(), 2);
    cache.set('a', []);
    cache.set('b', []);
    cache.get('a');
    cache.set('c', []);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toEqual([]);
    expect(cache.get('c')).toEqual([]);
  });

  test('a failed read gives an empty cache', async () => {
    const cache = new SearchCache({
      getItem: async () => { throw new Error('nope'); },
      setItem: async (_k, v) => v,
    });
    await cache.load();
    expect(cache.get('k')).toBeUndefined();
  });
});
