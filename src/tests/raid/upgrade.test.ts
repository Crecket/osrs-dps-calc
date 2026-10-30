import { describe, expect, test } from '@jest/globals';
import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { buildPlayer } from '@/best/lib/search';
import { basePlayer } from '@/best/lib/basePlayer';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';
import { EquipmentPiece } from '@/types/Player';
import { defaultSettings, raidBaseInputs } from '@/raid/lib/runRaid';
import { Candidate } from '@/raid/lib/candidates';
import { RaidPlan } from '@/raid/lib/assemble';
import { dpsRater, upgradeLoadout, UpgradeInput } from '@/raid/lib/upgrade';
import { SearchCache } from '@/raid/lib/searchCache';

const TBOW = 20997;
const MASK = 27235;
const BONECRUSHER = 22986;
const ANGUISH = 19547;
const DRAGON_ARROW = 11212;
const VENATOR_RING = 28310;
const VAMBRACES = 26235;
const item = (id: number) => availableEquipment.find((e) => e.id === id)!;
const rapid = getCombatStylesForCategory(item(TBOW).category).find((s) => s.stance === 'Rapid')!;
const inputs = raidBaseInputs(defaultSettings());
const playerFor = () => basePlayer(inputs, 'ranged');

const candidate = (phaseKey: string, dps: number): Candidate => {
  const player = buildPlayer(playerFor(), {
    style: 'ranged', weaponId: TBOW, combatStyle: rapid, ammoId: DRAGON_ARROW, spellName: null, dartId: null,
  }, { head: MASK, neck: BONECRUSHER });
  return {
    phaseKey,
    style: 'ranged',
    dps,
    setup: { id: phaseKey, name: 'Twisted bow', player },
    itemIds: [TBOW, MASK, BONECRUSHER, DRAGON_ARROW].map(getCanonicalItemId),
  };
};

const monster = (id: string) => ({ id, monster: { id: 1, name: id } } as unknown as BulkMonster);

// the Twisted bow does 10, 12 with the Necklace of anguish
const rate = async (setups: BulkSetup[]) => setups.map((s) => (s.player.equipment.neck?.id === ANGUISH ? 12 : 10));

const plan = (picks: Candidate[]): RaidPlan => {
  const ids = [...new Set(picks.flatMap((c) => c.itemIds))];
  return {
    itemIds: ids,
    cost: 0,
    totalSeconds: picks.length * 100,
    picks: picks.map((c) => ({
      key: c.phaseKey, hp: 1000, candidate: c, seconds: 100,
    })),
    overBudget: false,
    main: picks[0],
  };
};

const pool: EquipmentPiece[] = [item(BONECRUSHER), item(ANGUISH), item(TBOW), item(MASK), item(DRAGON_ARROW)];

const input = (over: Partial<UpgradeInput>): UpgradeInput => {
  const picks = [candidate('a', 10), candidate('b', 10)];
  return {
    plan: plan(picks),
    monsters: new Map([['a', monster('a')], ['b', monster('b')]]),
    candidates: picks,
    pool,
    priceOf: (id) => (id === ANGUISH ? 20e6 : 0),
    budget: 100e6,
    maxItems: 20,
    requiredIds: [],
    excluded: new Set(),
    extraDps: 0,
    playerFor,
    ...over,
  };
};

describe('upgradeLoadout', () => {
  test('two variants of one item merge into the one that has both: Avernic treads (pe) and (pr) become (max)', async () => {
    const [PE, PR, MAX] = [31092, 31091, 31097];
    const withFeet = (c: Candidate, feet: number): Candidate => {
      const player = buildPlayer(playerFor(), {
        style: 'ranged', weaponId: TBOW, combatStyle: rapid, ammoId: DRAGON_ARROW, spellName: null, dartId: null,
      }, { head: MASK, neck: BONECRUSHER, feet });
      return { ...c, setup: { ...c.setup, player }, itemIds: [...c.itemIds, feet] };
    };
    const picks = [withFeet(candidate('a', 10), PE), withFeet(candidate('b', 10), PR)];
    const result = await upgradeLoadout(input({
      plan: plan(picks), candidates: picks, pool: [...pool, item(PE), item(PR), item(MAX)], priceOf: () => 0,
    }), async (setups) => setups.map(() => 10));
    expect(result.itemIds).toContain(MAX);
    expect(result.itemIds).not.toContain(PE);
    expect(result.itemIds).not.toContain(PR);
    result.picks.forEach((p) => expect(p.candidate?.setup.player.equipment.feet?.id).toBe(MAX));
  });

  test('puts a better item into a slot when the budget allows', async () => {
    const result = await upgradeLoadout(input({}), rate);
    expect(result.itemIds).toContain(ANGUISH);
    expect(result.itemIds).not.toContain(BONECRUSHER);
    expect(result.cost).toBe(20e6);
    // 1000 hp at 12 dps on both phases
    expect(result.totalSeconds).toBeCloseTo(2 * (1000 / 12));
    result.picks.forEach((p) => {
      expect(p.candidate!.setup.player.equipment.neck?.id).toBe(ANGUISH);
      expect(p.candidate!.dps).toBe(12);
    });
    expect(result.main?.setup.player.equipment.neck?.id).toBe(ANGUISH);
  });

  test('with the budget spent, a cheaper item in one slot pays for a bigger gain in another', async () => {
    const VOID_HELM = 11664;
    // the mask is worth 0.5 over the void helm, the Necklace of anguish 2 over the Bonecrusher necklace
    const traded = async (setups: BulkSetup[]) => setups.map((s) => 10
      + (s.player.equipment.neck?.id === ANGUISH ? 2 : 0) - (s.player.equipment.head?.id === MASK ? 0 : 0.5));
    const prices: Record<number, number> = { [MASK]: 15e6, [ANGUISH]: 20e6 };
    const result = await upgradeLoadout(input({
      pool: [...pool, item(VOID_HELM)], priceOf: (id) => prices[id] ?? 0, budget: 20e6,
    }), traded);
    expect(result.itemIds).toEqual(expect.arrayContaining([ANGUISH, VOID_HELM]));
    expect(result.itemIds).not.toContain(MASK);
    expect(result.cost).toBeLessThanOrEqual(20e6);
    expect(result.totalSeconds).toBeCloseTo(2 * (1000 / 11.5));
  });

  test('tries the weapon\'s other stances: the searched one may not be the fastest after an upgrade', async () => {
    const byStance = async (setups: BulkSetup[]) => setups.map((st) => (st.player.style.stance === 'Longrange' ? 11 : 10));
    const result = await upgradeLoadout(input({ pool: [] }), byStance);
    expect(result.picks.map((p) => p.candidate?.setup.player.style.stance)).toEqual(['Longrange', 'Longrange']);
    expect(result.totalSeconds).toBeCloseTo(2 * (1000 / 11));
  });

  test('stays within the budget', async () => {
    const result = await upgradeLoadout(input({ budget: 10e6 }), rate);
    expect(result.itemIds).toContain(BONECRUSHER);
    expect(result.itemIds).not.toContain(ANGUISH);
    expect(result.totalSeconds).toBeCloseTo(200);
  });

  test('a swap that replaces an item fits a full loadout', async () => {
    const result = await upgradeLoadout(input({ maxItems: 4 }), rate);
    expect(result.itemIds).toContain(ANGUISH);
    expect(result.itemIds).toHaveLength(4);
  });

  test('an item for an empty slot only fits below the item limit', async () => {
    const hands = async (setups: BulkSetup[]) => setups.map((s) => (s.player.equipment.hands?.id === VAMBRACES ? 12 : 10));
    const withHands = { pool: [...pool, item(VAMBRACES)], excluded: new Set([ANGUISH]) };
    expect((await upgradeLoadout(input({ ...withHands, maxItems: 4 }), hands)).itemIds).not.toContain(VAMBRACES);
    expect((await upgradeLoadout(input({ ...withHands, maxItems: 5 }), hands)).itemIds).toContain(VAMBRACES);
  });

  test('an item for an empty slot has to save real time to take a bag cell', async () => {
    const hands = (withVambraces: number) => async (setups: BulkSetup[]) => setups.map((s) => (s.player.equipment.hands?.id === VAMBRACES ? withVambraces : 10));
    const withHands = { pool: [...pool, item(VAMBRACES)], excluded: new Set([ANGUISH]) };
    // 2 * (1000 / 10 - 1000 / 10.05): about a second
    expect((await upgradeLoadout(input(withHands), hands(10.05))).itemIds).not.toContain(VAMBRACES);
    expect((await upgradeLoadout(input(withHands), hands(12))).itemIds).toContain(VAMBRACES);
  });

  test('a ranged setup keeps its ring: the Lightbearer is never swapped for a Venator ring', async () => {
    const ring = async (setups: BulkSetup[]) => setups.map((s) => (s.player.equipment.ring?.id === VENATOR_RING ? 12 : 10));
    const result = await upgradeLoadout(input({ pool: [...pool, item(VENATOR_RING)], excluded: new Set([ANGUISH]) }), ring);
    expect(result.itemIds).not.toContain(VENATOR_RING);
  });

  test('never uses an excluded item', async () => {
    const result = await upgradeLoadout(input({ excluded: new Set([ANGUISH]) }), rate);
    expect(result.itemIds).not.toContain(ANGUISH);
  });
});

describe('dpsRater', () => {
  test('computes DPS on the rows pool once per setup and monster', async () => {
    const runs: number[] = [];
    const deps = {
      search: { run: async () => [], cancel: () => {} },
      rows: {
        run: async (setups: BulkSetup[]) => {
          runs.push(setups.length);
          return setups.map((st) => ({ setupId: st.id, dps: 7 } as BulkRow));
        },
        cancel: () => {},
      },
    } as never;
    const storage = { getItem: async () => null, setItem: async <T>(_: string, v: T) => v };
    const rateOf = dpsRater(deps, new SearchCache(storage));
    const setup = candidate('a', 10).setup;
    expect(await rateOf([setup], monster('a'))).toEqual([7]);
    expect(await rateOf([setup], monster('a'))).toEqual([7]);
    expect(runs).toEqual([1]);
  });
});
