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
import {
  rankSpecs, routeSpec, specChoices, specRanking, specSaving,
} from '@/raid/lib/specs';

const ZCB = 26374;
const KISTEN = 33631;

describe('routeSpec', () => {
  test('skips spec weapons that aren\'t affordable', () => {
    const zcb = {
      weaponId: 26374, cost: 75, expected: 100, dps: 28, ammoId: null,
    };
    const claws = {
      weaponId: 13652, cost: 50, expected: 57, dps: 24, ammoId: null,
    };
    const specs = { a: [zcb, claws], b: [zcb, claws] };
    expect(routeSpec(specs)?.weaponId).toBe(26374);
    expect(routeSpec(specs, (r) => r.weaponId !== 26374)?.weaponId).toBe(13652);
  });

  test('specChoices offers the best spec at a few price levels, a free one and none', () => {
    const zcb = {
      weaponId: 26374, cost: 75, expected: 100, dps: 28, ammoId: null,
    };
    const claws = {
      weaponId: 13652, cost: 50, expected: 57, dps: 24, ammoId: null,
    };
    const prices = new Map([[26374, 361e6], [13652, 31e6]]);
    const choices = specChoices({ a: [zcb, claws] }, (id) => prices.get(id) ?? 0, 400e6);
    expect(choices.map((c) => c?.weaponId ?? null)).toEqual([26374, 13652, null]);
  });

  test('specSaving counts the energy the raid regenerates, less the Defence specs, on the phases the spec can hit', () => {
    const claws = {
      weaponId: 13652, cost: 50, expected: 60, dps: 25, ammoId: null,
    };
    const melee = { style: 'slash' } as Candidate;
    // 10 dps for 300 s: 100 + 100 energy, so 4 specs, each dealing 60 where the setup deals 24 in its 2.4 s: 3.6 s saved
    const picks = [{
      key: 'a', hp: 3000, seconds: 300, candidate: melee,
    }];
    expect(specSaving(claws, { a: [claws] }, picks, 0)).toBeCloseTo(4 * 3.6);
    expect(specSaving(claws, { a: [claws] }, picks, 100)).toBeCloseTo(2 * 3.6);
    expect(specSaving(claws, { b: [claws] }, picks, 0)).toBe(0);
    expect(specSaving(null, { a: [claws] }, picks, 0)).toBe(0);
  });
});

describe('rankSpecs', () => {
  test('ranks by damage per second of the spec, best first, leaving out specs without damage', () => {
    const ranked = rankSpecs([
      // a slow spec: more damage, but over 9 ticks
      {
        weaponId: 11235, cost: 55, expected: 100, ticks: 9, ammoId: null,
      },
      {
        weaponId: KISTEN, cost: 50, expected: 70, ticks: 4, ammoId: null,
      },
      {
        weaponId: 1, cost: 50, expected: 0, ticks: 4, ammoId: null,
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
  const [phase] = routePhases(fa, fa.defaultRoute, {});
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
    const [bork] = routePhases(fa, fa.defaultRoute, {}).filter((p) => p.phase.key === 'bork:2');
    await specRanking([bork], [{ ...candidate, phaseKey: 'bork:2', style: 'slash' }], [], deps, new SearchCache(memoryStorage()));
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
    const [bork] = routePhases(fa, fa.defaultRoute, {}).filter((p) => p.phase.key === 'bork:2');
    await specRanking([bork], [{ ...candidate, phaseKey: 'bork:2', style: 'crush' }], [], deps, new SearchCache(memoryStorage()));
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
