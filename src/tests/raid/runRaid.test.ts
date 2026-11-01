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
  attackLabel, dartOptions, defaultSettings, excludedOf, plannedCounts, raidBaseInputs, requiredItems, runRaid, searchesNeeded, weaponTiers,
} from '@/raid/lib/runRaid';
import { Candidate } from '@/raid/lib/candidates';
import { routePhases } from '@/raid/lib/route';
import { raidById } from '@/raid/raids';

const tbow = availableEquipment.find((e) => e.id === 20997)!;
const rapid = getCombatStylesForCategory(tbow.category).find((s) => s.stance === 'Rapid')!;

const mockSearch = jest.fn<(...args: unknown[]) => Promise<StyleOutcome[]>>();
const search = ((...args: unknown[]) => mockSearch(...args)) as never;
// every setup the planner rates does 10 DPS, as the searched ones do
const rateAll = async (setups: { id: string }[]) => setups.map((st) => ({ setupId: st.id, dps: 10 }));
const deps = { search: { run: jest.fn(), cancel: jest.fn() }, rows: { run: jest.fn(rateAll), cancel: jest.fn() } } as never;

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
      runnersUp: [],
    }];
  });
});

describe('weaponTiers', () => {
  test('per phase every searched weapon at its best, fastest first, with its price and whether the loadout holds it', () => {
    const c = (phaseKey: string, weaponId: number, style: Candidate['style'], dps: number) => ({
      phaseKey, style, dps, itemIds: [weaponId], setup: { player: { equipment: { weapon: { id: weaponId } }, style: { name: 'Hack', type: style, stance: 'Aggressive' }, spell: null } },
    }) as unknown as Candidate;
    const tiers = weaponTiers([
      c('a', 20997, 'ranged', 10), c('a', 20997, 'ranged', 12), c('a', 26374, 'ranged', 11), c('a', 22325, 'slash', 9), c('b', 4151, 'slash', 5),
    ], new Map([['a', 1200], ['b', 500]]), 0.5, (id) => (id === 20997 ? 1e9 : 0), [26374]);
    expect(tiers.a).toEqual([
      {
        weaponId: 20997, style: 'ranged', dps: 12.5, seconds: 96, cost: 1e9, held: false, attack: 'ranged · Hack (Aggressive)',
      },
      {
        weaponId: 26374, style: 'ranged', dps: 11.5, seconds: 1200 / 11.5, cost: 0, held: true, attack: 'ranged · Hack (Aggressive)',
      },
      {
        weaponId: 22325, style: 'slash', dps: 9.5, seconds: 1200 / 9.5, cost: 0, held: false, attack: 'slash · Hack (Aggressive)',
      },
    ]);
    expect(tiers.b.map((t) => t.weaponId)).toEqual([4151]);
  });
});

describe('attackLabel', () => {
  test('the attack type and stance, so a Soulreaper axe reads as crush or slash', () => {
    const axe = availableEquipment.find((e) => e.name === 'Soulreaper axe')!;
    const smash = getCombatStylesForCategory(axe.category).find((s) => s.type === 'crush')!;
    const player = buildPlayer(basePlayer(raidBaseInputs(defaultSettings()), 'crush'), {
      style: 'crush', weaponId: axe.id, combatStyle: smash, ammoId: null, spellName: null, dartId: null,
    }, {});
    expect(attackLabel(player)).toBe(`crush · ${smash.name} (${smash.stance})`);
  });
});

describe('excludedOf', () => {
  test('darts stronger than the best one the account can use are left out, with the excluded items', () => {
    const darts = dartOptions();
    expect(darts.map((d) => d.name).slice(0, 2)).toEqual(['Dragon dart', 'Amethyst dart']);
    const amethyst = darts[1].id;
    const excluded = excludedOf({ ...defaultSettings(), excludedIds: [4151], bestDart: amethyst });
    expect(excluded).toEqual(expect.arrayContaining([4151, darts[0].id]));
    expect(excluded).not.toContain(amethyst);
    expect(excludedOf({ ...defaultSettings(), bestDart: null })).toEqual([]);
  });
});

const fa = raidById('fractured-archive');

describe('requiredItems', () => {
  test('an excluded defence weapon stays out of the bag, though a teammate still lowers Defence with it', () => {
    const settings = { ...defaultSettings(), excludedIds: [21003, 28922] };
    const ids = requiredItems(settings);
    expect(ids).not.toContain(21003);
    expect(ids).not.toContain(28922);
    expect(ids).not.toContain(13576);
    const bork = routePhases(fa, settings.route, settings.counts).find((p) => p.phase.key === 'bork:0')!;
    expect(bork.counts.elderMaul).toBe(2);
  });

  test('Defence weapons take at most 30% of the budget; the Dragon warhammer takes the specs of one that doesn\'t fit', () => {
    const prices = new Map([[21003, 89e6], [28922, 179e6], [13576, 13e6]]);
    const priceOf = (id: number) => prices.get(id) ?? 0;
    const specs = (budget: number) => {
      const counts = plannedCounts({ ...defaultSettings(), budget }, priceOf);
      return Object.values(counts).reduce((n, c) => ({
        elderMaul: n.elderMaul + c.elderMaul, dwh: n.dwh + c.dwh, tonalztic: n.tonalztic + c.tonalztic,
      }), { elderMaul: 0, dwh: 0, tonalztic: 0 });
    };
    const all = specs(10e9);
    expect(all.elderMaul).toBeGreaterThan(0);
    expect(all.tonalztic).toBeGreaterThan(0);
    // 100m: neither the maul nor the Tonalztics, every spec done with the Dragon warhammer
    const small = requiredItems({ ...defaultSettings(), budget: 100e6 }, priceOf);
    expect(small).toContain(13576);
    expect(small).not.toContain(21003);
    expect(small).not.toContain(28922);
    expect(specs(100e6)).toEqual({ elderMaul: 0, tonalztic: 0, dwh: all.dwh + all.elderMaul + all.tonalztic });
    // 500m: the maul (89m of the 150m), not the Tonalztics too
    expect(requiredItems({ ...defaultSettings(), budget: 500e6 }, priceOf)).toEqual(expect.arrayContaining([21003, 13576]));
    expect(specs(500e6)).toEqual({ elderMaul: all.elderMaul, tonalztic: 0, dwh: all.dwh + all.tonalztic });
    // 1b: both
    expect(requiredItems({ ...defaultSettings(), budget: 1e9 }, priceOf)).toEqual(expect.arrayContaining([21003, 28922]));
    // without prices nothing is weighed
    expect(requiredItems({ ...defaultSettings(), budget: 100e6 })).toEqual(expect.arrayContaining([21003, 28922]));
  });
});

describe('raidBaseInputs', () => {
  test('searches the chosen styles, without stab and magic by default', () => {
    expect(defaultSettings().styles).toEqual(['slash', 'crush', 'ranged']);
    expect(raidBaseInputs({ ...defaultSettings(), styles: ['ranged'] }).styles).toEqual(['ranged']);
  });

  test('the account\'s levels, prayers, potions and conditions go to the searches', () => {
    const account = { ...defaultSettings().account, skills: { ...defaultSettings().account.skills, ranged: 80 } };
    const inputs = raidBaseInputs({ ...defaultSettings(), account: { ...account, prayerOverrides: { ranged: [] } } });
    expect(inputs.skills.ranged).toBe(80);
    expect(inputs.prayerOverrides).toEqual({ ranged: [] });
  });

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
    expect(result.phases.map((p) => p.key)).toEqual([...new Set(result.plan.picks.map((p) => p.key))]);
    expect(result.plan.totalSeconds).toBeGreaterThan(0);
  });

  test('a phase split by style is planned per part', async () => {
    const cache = new SearchCache(memoryStorage());
    const result = await runRaid(defaultSettings(), null, deps, () => {}, cache, search);
    expect(result.plan.picks.filter((p) => p.key === 'ocellus:2')).toHaveLength(2);
    expect(result.phases.find((p) => p.key === 'ocellus:2')?.parts).toEqual([
      { styles: ['ranged'], share: 0.5 }, { styles: ['stab', 'slash', 'crush'], share: 0.5 },
    ]);
  });

  test('each phase lists the loadout\'s weapons with their DPS', async () => {
    const cache = new SearchCache(memoryStorage());
    const result = await runRaid(defaultSettings(), null, deps, () => {}, cache, search);
    const first = result.options[result.phases[0].key];
    expect(first).toEqual([expect.objectContaining({ weaponId: 20997, dps: 10 + 0.625 })]);
    expect(first[0].seconds).toBeCloseTo(result.phases[0].hp / 10.625);
  });

  test('re-plans with fewer items when switches overflow the inventory, but keeps a setup for every phase', async () => {
    const whip = availableEquipment.find((e) => e.id === 4151)!;
    const lash = getCombatStylesForCategory(whip.category)[0];
    // the Guardian's phases use the Twisted bow setup, every other phase a whip setup: 6 items, 3 worn
    mockSearch.mockImplementation(async (...args: unknown[]) => {
      const { monster } = args[1] as { monster: { id: number } };
      const inputs = raidBaseInputs(defaultSettings());
      const ranged = monster.id === 16659;
      const player = ranged
        ? buildPlayer(basePlayer(inputs, 'ranged'), {
          style: 'ranged', weaponId: 20997, combatStyle: rapid, ammoId: 11212, spellName: null, dartId: null,
        }, { head: 27235 })
        : buildPlayer(basePlayer(inputs, 'slash'), {
          style: 'slash', weaponId: 4151, combatStyle: lash, ammoId: null, spellName: null, dartId: null,
        }, { head: 10828, hands: 7462 });
      return [{
        style: ranged ? 'ranged' : 'slash',
        setups: [{ id: 's', name: 's', player }],
        rows: [{ setupId: 's', dps: 10 } as BulkRow],
        approximate: false,
        message: null,
        variants: {},
        runnersUp: [],
      }];
    });
    const cache = new SearchCache(memoryStorage());
    // no room for switches: 20 brews + 6 restores + 1 reserved + rune pouch
    const settings = {
      ...defaultSettings(), magic: 'standard' as const, counts: {}, supplies: { brews: 20, restores: 6, reserved: 1 },
    };
    const zeroSpecs = Object.fromEntries(['guardian:0', 'guardian:1', 'bork:0', 'bork:1', 'dreadnoth:0', 'xarth:0', 'ocellus:0', 'ocellus:1', 'ocellus:2']
      .map((k) => [k, { elderMaul: 0, dwh: 0, tonalztic: 0 }]));
    const result = await runRaid({ ...settings, counts: zeroSpecs }, null, deps, () => {}, cache, search);
    // everything that isn't needed for a phase's only setup is dropped: the bow worn, the whip (the only weapon for the
    // melee-only phases) in the one cell the bag lacks; no phase is left without a setup to make room
    expect(result.plan.picks.every((p) => p.candidate !== null)).toBe(true);
    expect([...result.plan.itemIds].sort((a, b) => a - b)).toEqual([4151, 11212, 20997]);
    expect(result.layout.overflow).toBe(1);
  });

  test('ranks spec weapons per phase', async () => {
    const rows = {
      run: jest.fn(async (setups: { id: string; player: { equipment: { weapon: { id: number } | null } } }[]) => setups
        .map((st) => ({ setupId: st.id, spec: { expected: st.player.equipment.weapon?.id === 26374 ? 90 : 0 } }))),
      cancel: jest.fn(),
    };
    const result = await runRaid(defaultSettings(), null, { ...(deps as object), rows } as never, () => {}, new SearchCache(memoryStorage()), search);
    expect(result.specs[result.phases[0].key].map((r) => r.weaponId)).toEqual([26374]);
  });

  test('the best spec weapon of the route is brought, with its spec ammo', async () => {
    const rows = {
      run: jest.fn(async (setups: { id: string; player: { equipment: { weapon: { id: number } | null } } }[]) => setups
        .map((st) => ({ setupId: st.id, dps: 10, spec: { expected: st.player.equipment.weapon?.id === 26374 ? 90 : 0 } }))),
      cancel: jest.fn(),
    };
    const result = await runRaid(defaultSettings(), null, { ...(deps as object), rows } as never, () => {}, new SearchCache(memoryStorage()), search);
    // the Zaryte crossbow and its ruby dragon bolts (e)
    expect(result.plan.itemIds).toEqual(expect.arrayContaining([26374, 21944]));
    expect(result.layout.inventory.some((c) => c?.kind === 'item' && c.itemId === 26374)).toBe(true);
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
