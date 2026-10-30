import { describe, expect, test } from '@jest/globals';
import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { buildPlayer, Gear } from '@/best/lib/search';
import { basePlayer } from '@/best/lib/basePlayer';
import { BestStyle } from '@/best/types';
import { BulkMonster, BulkSetup, GEAR_SLOT_ORDER } from '@/bulk/types';
import { EquipmentPiece } from '@/types/Player';
import { defaultSettings, raidBaseInputs } from '@/raid/lib/runRaid';
import { Candidate } from '@/raid/lib/candidates';
import { NO_SETUP_DPS } from '@/raid/lib/assemble';
import { KitInput, planKits } from '@/raid/lib/kits';

const TBOW = 20997;
const ARROW = 11212;
const BOWFA = 25865;
const MASORI = [27235, 27238, 27241];
const VOID = [11664, 13072, 13073, 8842];
const SCYTHE = 22325;
const TORVA = 26382;
const ZCB = 26374;
const VENATOR_RING = 28310;
const LIGHTBEARER = 25975;
const RUBY = 21944;

const item = (id: number) => availableEquipment.find((e) => e.id === id)!;
const inputs = raidBaseInputs(defaultSettings());
const playerFor = (style: BestStyle) => basePlayer(inputs, style);

const gearOf = (ids: number[]): Gear => Object.fromEntries(ids.map((id) => [item(id).slot, id]));

const cand = (phaseKey: string, style: BestStyle, weaponId: number, ammoId: number | null, gear: number[], dps: number): Candidate => {
  const weapon = item(weaponId);
  const combatStyle = getCombatStylesForCategory(weapon.category).find((s) => (style === 'ranged' ? s.stance === 'Rapid' : s.type === style))!;
  const player = buildPlayer(playerFor(style), {
    style, weaponId, combatStyle, ammoId, spellName: null, dartId: null,
  }, gearOf(gear));
  const worn = GEAR_SLOT_ORDER.map((slot) => player.equipment[slot]).filter((e): e is EquipmentPiece => !!e);
  return {
    phaseKey, style, dps, setup: { id: `${phaseKey}-${weaponId}`, name: weapon.name, player }, itemIds: [...new Set(worn.map((e) => getCanonicalItemId(e.id)))],
  };
};

const has = (s: BulkSetup, ids: number[]) => ids.every((id) => Object.values(s.player.equipment).some((e) => e?.id === id));

/** DPS by what the setup holds: the Twisted bow in Masori is best everywhere, void and the bowfa are worse, the scythe hits 12 */
const rate = async (setups: BulkSetup[]) => setups.map((s) => {
  const weapon = s.player.equipment.weapon?.id;
  if (weapon === SCYTHE) return has(s, [TORVA]) ? 12 : 8;
  const armour = has(s, MASORI) ? 3 : 0;
  if (weapon === TBOW) return 9 + armour;
  if (weapon === BOWFA) return 7 + armour;
  return 0;
});

const monster = (id: string) => ({ id, monster: { id: 1, name: id } } as unknown as BulkMonster);

const input = (over: Partial<KitInput>): KitInput => ({
  units: [{ key: 'a', hp: 1200 }, { key: 'b', hp: 1200 }],
  monsters: new Map(['a', 'b', 'c'].map((k) => [k, monster(k)])),
  candidates: [
    // the searches found Masori + Twisted bow on a, void + bowfa on b
    cand('a', 'ranged', TBOW, ARROW, MASORI, 12),
    cand('b', 'ranged', BOWFA, null, VOID, 7),
  ],
  priceOf: () => 0,
  budget: 1e12,
  maxItems: 30,
  requiredIds: [],
  extraDps: 0,
  playerFor,
  ...over,
});

describe('planKits', () => {
  test('one ranged kit for every phase: Masori and the Twisted bow, no void', async () => {
    const plan = await planKits(input({}), rate);
    expect(plan.itemIds).toEqual(expect.arrayContaining([TBOW, ...MASORI]));
    VOID.forEach((id) => expect(plan.itemIds).not.toContain(id));
    expect(plan.itemIds).not.toContain(BOWFA);
    plan.picks.forEach((p) => expect(p.candidate?.dps).toBe(12));
    expect(plan.totalSeconds).toBeCloseTo(200);
  });

  test('a dearer weapon that is best on its own phases is kept next to a cheaper one', async () => {
    // the bowfa is best on a, the Twisted bow on b; both are worth bringing with the budget
    const byPhase = async (setups: BulkSetup[], m: BulkMonster) => setups.map((s) => {
      const weapon = s.player.equipment.weapon?.id;
      if (weapon === BOWFA) return m.id === 'a' ? 14 : 8;
      if (weapon === TBOW) return m.id === 'b' ? 14 : 8;
      return 0;
    });
    const prices: Record<number, number> = { [TBOW]: 1e9, [BOWFA]: 4e7 };
    const plan = await planKits(input({
      priceOf: (id) => prices[id] ?? 0,
      budget: 2e9,
      candidates: [cand('a', 'ranged', BOWFA, null, MASORI, 14), cand('b', 'ranged', TBOW, ARROW, MASORI, 14)],
    }), byPhase);
    expect(plan.itemIds).toEqual(expect.arrayContaining([TBOW, BOWFA]));
    expect(plan.totalSeconds).toBeCloseTo(2 * (1200 / 14));
  });

  test('stays within the budget', async () => {
    const prices: Record<number, number> = { [TBOW]: 1e9 };
    const plan = await planKits(input({ priceOf: (id) => prices[id] ?? 0, budget: 5e8 }), rate);
    expect(plan.itemIds).not.toContain(TBOW);
    expect(plan.itemIds).toContain(BOWFA);
    expect(plan.cost).toBeLessThanOrEqual(5e8);
  });

  test('a melee part brings a melee kit next to the ranged one', async () => {
    const plan = await planKits(input({
      units: [{ key: 'a', hp: 1200, styles: ['ranged'] }, { key: 'c', hp: 600, styles: ['stab', 'slash', 'crush'] }],
      candidates: [...input({}).candidates, cand('c', 'slash', SCYTHE, null, [TORVA], 12)],
    }), rate);
    expect(plan.itemIds).toEqual(expect.arrayContaining([TBOW, SCYTHE, TORVA]));
    expect(plan.picks.find((p) => p.key === 'c')?.candidate?.style).toBe('slash');
  });

  test('a phase only some styles can hit never uses another style', async () => {
    const plan = await planKits(input({
      units: [{ key: 'a', hp: 1200, styles: ['slash'] }],
      candidates: [cand('a', 'ranged', TBOW, ARROW, MASORI, 12)],
    }), rate);
    expect(plan.picks[0].candidate).toBeNull();
    expect(plan.totalSeconds).toBeCloseTo(1200 / NO_SETUP_DPS);
  });

  test('a required weapon is a mainhand option too: the spec Zaryte crossbow beats the searched Twisted bow', async () => {
    const zcbBest = async (setups: BulkSetup[]) => setups.map((s) => {
      const weapon = s.player.equipment.weapon?.id;
      if (weapon === ZCB) return s.player.equipment.ammo?.id === RUBY ? 15 : 0;
      return weapon === TBOW ? 12 : 0;
    });
    const plan = await planKits(input({
      units: [{ key: 'a', hp: 1200 }],
      candidates: [cand('a', 'ranged', TBOW, ARROW, MASORI, 12)],
      requiredIds: [ZCB, RUBY],
    }), zcbBest);
    expect(plan.picks[0].candidate?.setup.player.equipment.weapon?.id).toBe(ZCB);
    expect(plan.totalSeconds).toBeCloseTo(1200 / 15);
  });

  test('with the slots full, a weapon picked first is swapped out when another pair of weapons is faster', async () => {
    // the bowfa is decent everywhere, the Twisted bow great on a and b, the Zaryte crossbow great on c; only two fit
    const byPhase = async (setups: BulkSetup[], m: BulkMonster) => setups.map((s) => {
      const weapon = s.player.equipment.weapon?.id;
      if (weapon === BOWFA) return 10;
      if (weapon === TBOW) return m.id === 'c' ? 2 : 14;
      if (weapon === ZCB) return m.id === 'c' ? 14 : 2;
      return 0;
    });
    const plan = await planKits(input({
      units: [{ key: 'a', hp: 1200 }, { key: 'b', hp: 1200 }, { key: 'c', hp: 1200 }],
      candidates: [
        cand('a', 'ranged', BOWFA, null, MASORI, 10),
        cand('a', 'ranged', TBOW, ARROW, MASORI, 14),
        cand('c', 'ranged', ZCB, RUBY, MASORI, 14),
      ],
      // Masori and the Lightbearer, and either the Twisted bow and the crossbow with their ammo, or the bowfa and one of them
      maxItems: 8,
    }), byPhase);
    expect(plan.itemIds).toEqual(expect.arrayContaining([TBOW, ZCB]));
    expect(plan.itemIds).not.toContain(BOWFA);
    expect(plan.totalSeconds).toBeCloseTo(3 * (1200 / 14));
  });

  test('ranged kits wear the Lightbearer instead of the searched ring', async () => {
    const plan = await planKits(input({
      units: [{ key: 'a', hp: 1200 }],
      candidates: [cand('a', 'ranged', TBOW, ARROW, [...MASORI, VENATOR_RING], 12)],
    }), rate);
    expect(plan.itemIds).toContain(LIGHTBEARER);
    expect(plan.itemIds).not.toContain(VENATOR_RING);
    expect(plan.picks[0].candidate?.setup.player.equipment.ring?.id).toBe(LIGHTBEARER);
  });

  test('the item limit holds', async () => {
    const plan = await planKits(input({
      units: [{ key: 'a', hp: 1200 }, { key: 'c', hp: 600, styles: ['stab', 'slash', 'crush'] }],
      candidates: [...input({}).candidates, cand('c', 'slash', SCYTHE, null, [TORVA], 12)],
      maxItems: 5,
    }), rate);
    expect(plan.itemIds.length).toBeLessThanOrEqual(5);
  });
});
