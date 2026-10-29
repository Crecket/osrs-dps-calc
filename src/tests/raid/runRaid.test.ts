import {
  beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import type { StyleOutcome } from '@/best/lib/run';
import { buildPlayer } from '@/best/lib/search';
import { basePlayer } from '@/best/lib/basePlayer';
import { BulkRow } from '@/bulk/types';
import { SearchCache } from '@/raid/lib/searchCache';
import {
  defaultSettings, raidBaseInputs, runRaid, searchesNeeded,
} from '@/raid/lib/runRaid';

const tbow = availableEquipment.find((e) => e.id === 20997)!;
const rapid = getCombatStylesForCategory(tbow.category).find((s) => s.stance === 'Rapid')!;

const mockSearch = jest.fn<(...args: unknown[]) => Promise<StyleOutcome[]>>();
const search = ((...args: unknown[]) => mockSearch(...args)) as never;
const deps = { search: { run: jest.fn(), cancel: jest.fn() }, rows: { run: jest.fn(), cancel: jest.fn() } } as never;

const memoryStorage = () => {
  const data = new Map<string, unknown>();
  return {
    getItem: async <T>(key: string) => (data.get(key) as T) ?? null,
    setItem: async <T>(key: string, value: T) => {
      data.set(key, value);
      return value;
    },
  };
};

beforeEach(() => {
  mockSearch.mockReset();
  mockSearch.mockImplementation(async () => {
    const inputs = raidBaseInputs(defaultSettings());
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
  });
});

describe('raidBaseInputs', () => {
  test('spellbooks follow the magic option', () => {
    expect(raidBaseInputs({ ...defaultSettings(), magic: 'thralls' }).spellbooks).toEqual([]);
    expect(raidBaseInputs({ ...defaultSettings(), magic: 'none' }).spellbooks).toEqual([]);
    expect(raidBaseInputs({ ...defaultSettings(), magic: 'ancients' }).spellbooks).toEqual(['ancient']);
    expect(raidBaseInputs({ ...defaultSettings(), magic: 'standard' }).spellbooks).toEqual(['standard']);
  });
});

describe('runRaid', () => {
  test('returns a plan with a full inventory and the Twisted bow worn', async () => {
    const cache = new SearchCache(memoryStorage());
    const result = await runRaid(defaultSettings(), null, deps, () => {}, cache, search);
    expect(mockSearch).toHaveBeenCalled();
    expect(result.layout.inventory).toHaveLength(28);
    expect(result.layout.worn.weapon).toBe(20997);
    expect(result.phases.map((p) => p.key)).toEqual(result.plan.picks.map((p) => p.key));
    expect(result.plan.totalSeconds).toBeGreaterThan(0);
  });

  test('each phase lists the loadout\'s weapons with their DPS', async () => {
    const cache = new SearchCache(memoryStorage());
    const result = await runRaid(defaultSettings(), null, deps, () => {}, cache, search);
    const first = result.options[result.phases[0].key];
    expect(first).toEqual([expect.objectContaining({ weaponId: 20997, dps: 10 + 0.625 })]);
    expect(first[0].seconds).toBeCloseTo(result.phases[0].hp / 10.625);
  });

  test('a cheap change re-plans from the cache without searching', async () => {
    const cache = new SearchCache(memoryStorage());
    const settings = defaultSettings();
    await runRaid(settings, null, deps, () => {}, cache, search);
    mockSearch.mockClear();
    const changed = { ...settings, supplies: { ...settings.supplies, brews: 8 } };
    expect(searchesNeeded(changed, null, cache)).toBe(0);
    const result = await runRaid(changed, null, deps, () => {}, cache, search);
    expect(mockSearch).not.toHaveBeenCalled();
    expect(result.layout.inventory.filter((c) => c?.kind === 'supply' && c.label === 'Brew')).toHaveLength(8);
  });

  test('a route change needs new searches', async () => {
    const cache = new SearchCache(memoryStorage());
    const settings = defaultSettings();
    await runRaid(settings, null, deps, () => {}, cache, search);
    expect(searchesNeeded({ ...settings, route: { ...settings.route, second: 'ezekiel' } }, null, cache)).toBeGreaterThan(0);
  });
});
