import { describe, expect, test } from '@jest/globals';
import { BulkRow, BulkSetup } from '@/bulk/types';
import { raidById } from '@/raid/raids';
import { routePhases } from '@/raid/lib/route';
import { SearchCache } from '@/raid/lib/searchCache';
import { Candidate } from '@/raid/lib/candidates';
import { buildPlayer } from '@/best/lib/search';
import { generateEmptyPlayer } from '@/state';
import { availableEquipment } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { rankSpecs, specRanking } from '@/raid/lib/specs';

const ZCB = 26374;
const KISTEN = 33631;

describe('rankSpecs', () => {
  test('ranks by damage per second of the spec, best first, leaving out specs without damage', () => {
    const ranked = rankSpecs([
      // a slow spec: more damage, but over 9 ticks
      {
        weaponId: 11235, cost: 55, expected: 100, ticks: 9,
      },
      {
        weaponId: KISTEN, cost: 50, expected: 70, ticks: 4,
      },
      {
        weaponId: 1, cost: 50, expected: 0, ticks: 4,
      },
    ]);
    expect(ranked.map((r) => r.weaponId)).toEqual([KISTEN, 11235]);
    expect(ranked[0].dps).toBeCloseTo(70 / 2.4);
  });
});

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

describe('specRanking', () => {
  const fa = raidById('fractured-archive');
  const [phase] = routePhases(fa, fa.defaultRoute, {}, []);
  const tbow = availableEquipment.find((e) => e.id === 20997)!;
  const rapid = getCombatStylesForCategory(tbow.category).find((s) => s.stance === 'Rapid')!;
  const candidate: Candidate = {
    phaseKey: phase.phase.key,
    style: 'ranged',
    dps: 10,
    itemIds: [20997, 11212],
    setup: {
      id: 'c',
      name: 'c',
      player: buildPlayer(generateEmptyPlayer(), {
        style: 'ranged', weaponId: 20997, combatStyle: rapid, ammoId: 11212, spellName: null, dartId: null,
      }, {}),
    } as BulkSetup,
  };
  // only the Zaryte crossbow's spec does damage
  const rows = (calls: string[][]) => ({
    run: async (setups: BulkSetup[]) => {
      calls.push(setups.map((st) => st.player.equipment.weapon!.name));
      return setups.map((st) => ({
        setupId: st.id,
        spec: { expected: st.player.equipment.weapon?.id === ZCB ? 90 : 0 },
      }) as BulkRow);
    },
    cancel: () => {},
  });

  test('ranks spec weapons per phase on the phase\'s setup of their style, cached', async () => {
    const calls: string[][] = [];
    const cache = new SearchCache(memoryStorage());
    const deps = { search: { run: async () => [], cancel: () => {} }, rows: rows(calls) } as never;
    const ranking = await specRanking([phase], [candidate], [], deps, cache);
    expect(ranking[phase.phase.key].map((r) => r.weaponId)).toEqual([ZCB]);
    // the crossbow fires bolts, not the bow's arrows
    expect(calls.flat()).toContain('Zaryte crossbow');
    // defence weapons are not ranked
    expect(calls.flat()).not.toContain('Elder maul');
    expect(calls.flat()).not.toContain('Tonalztics of Ralos');

    calls.length = 0;
    await specRanking([phase], [candidate], [], deps, cache);
    expect(calls).toEqual([]);
  });

  test('no melee spec weapons on a phase that can\'t be meleed', async () => {
    const calls: string[][] = [];
    const deps = { search: { run: async () => [], cancel: () => {} }, rows: rows(calls) } as never;
    const melee = { ...candidate, style: 'slash' as const };
    await specRanking([phase], [candidate, melee], [], deps, new SearchCache(memoryStorage()));
    expect(calls.flat()).not.toContain('Crimson kisten');
  });

  test('melee spec weapons are ranked on the phase\'s melee setup', async () => {
    const calls: string[][] = [];
    const deps = { search: { run: async () => [], cancel: () => {} }, rows: rows(calls) } as never;
    const [bork] = routePhases(fa, fa.defaultRoute, {}, []).filter((p) => p.phase.key === 'bork:0');
    await specRanking([bork], [{ ...candidate, phaseKey: 'bork:0', style: 'slash' }], [], deps, new SearchCache(memoryStorage()));
    expect(calls.flat()).toContain('Crimson kisten');
  });

  test('a crossbow spec is ranked with ruby bolts (e)', async () => {
    const ammo: string[] = [];
    const deps = {
      search: { run: async () => [], cancel: () => {} },
      rows: {
        // the Zaryte crossbow's spec only shines with ruby bolts (e)
        run: async (setups: BulkSetup[]) => setups.map((st) => {
          const bolt = st.player.equipment.ammo?.name ?? '';
          if (st.player.equipment.weapon?.id === ZCB) ammo.push(bolt);
          const ruby = st.player.equipment.weapon?.id === ZCB && bolt === 'Ruby dragon bolts (e)';
          return { setupId: st.id, spec: { expected: ruby ? 90 : 10 } } as BulkRow;
        }),
        cancel: () => {},
      },
    } as never;
    const ranking = await specRanking([phase], [candidate], [], deps, new SearchCache(memoryStorage()));
    // ruby bolts only: no other bolt type is tried
    expect([...new Set(ammo)]).toEqual(['Ruby dragon bolts (e)']);
    expect(ranking[phase.phase.key].find((r) => r.weaponId === ZCB)?.expected).toBe(90);
    // one entry per weapon
    expect(ranking[phase.phase.key].filter((r) => r.weaponId === ZCB)).toHaveLength(1);
  });

  test('the Dual macuahuitl is never ranked: not worth bringing for its spec', async () => {
    const calls: string[][] = [];
    const deps = { search: { run: async () => [], cancel: () => {} }, rows: rows(calls) } as never;
    const [bork] = routePhases(fa, fa.defaultRoute, {}, []).filter((p) => p.phase.key === 'bork:0');
    await specRanking([bork], [{ ...candidate, phaseKey: 'bork:0', style: 'crush' }], [], deps, new SearchCache(memoryStorage()));
    expect(calls.flat()).not.toContain('Dual macuahuitl');
    expect(calls.flat()).toContain('Dragon claws');
  });

  test('excluded spec weapons are left out', async () => {
    const calls: string[][] = [];
    const deps = { search: { run: async () => [], cancel: () => {} }, rows: rows(calls) } as never;
    await specRanking([phase], [candidate], [ZCB], deps, new SearchCache(memoryStorage()));
    expect(calls.flat()).not.toContain('Zaryte crossbow');
  });
});
