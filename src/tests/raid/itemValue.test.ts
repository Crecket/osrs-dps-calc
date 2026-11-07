import { describe, expect, test } from '@jest/globals';
import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { buildPlayer } from '@/best/lib/search';
import { basePlayer } from '@/best/lib/basePlayer';
import { BulkMonster, BulkSetup } from '@/bulk/types';
import { defaultSettings, raidBaseInputs } from '@/raid/lib/runRaid';
import { Candidate } from '@/raid/lib/candidates';
import { itemReplacements, itemWorths, WorthContext } from '@/raid/lib/itemValue';

const [TBOW, MASK, BONECRUSHER, ANGUISH, DRAGON_ARROW] = [20997, 27235, 22986, 19547, 11212];
const item = (id: number) => availableEquipment.find((e) => e.id === id)!;
const inputs = raidBaseInputs(defaultSettings());
const playerFor = () => basePlayer(inputs, 'ranged');
const rapid = getCombatStylesForCategory(item(TBOW).category).find((s) => s.stance === 'Rapid')!;

const pick = (key: string, neck: number): Candidate => ({
  phaseKey: key,
  style: 'ranged',
  dps: neck === ANGUISH ? 12 : 10,
  setup: {
    id: key,
    name: 'Twisted bow',
    player: buildPlayer(playerFor(), {
      style: 'ranged', weaponId: TBOW, combatStyle: rapid, ammoId: DRAGON_ARROW, spellName: null, dartId: null,
    }, { head: MASK, neck }),
  },
  itemIds: [TBOW, MASK, neck, DRAGON_ARROW].map(getCanonicalItemId),
});

// the Twisted bow does 10, 12 with the Necklace of anguish
const rate = async (setups: BulkSetup[]) => setups.map((s) => (s.player.equipment.neck?.id === ANGUISH ? 12 : 10));
const ctx = (candidates: Candidate[]): WorthContext => ({
  picks: candidates.map((c) => ({
    key: c.phaseKey, hp: 1000, candidate: c, seconds: 1000 / c.dps,
  })),
  styles: candidates.map(() => undefined),
  monsters: new Map(candidates.map((c) => [c.phaseKey, { id: c.phaseKey, monster: { id: 1, name: c.phaseKey } } as unknown as BulkMonster])),
  extraDps: 0,
  rate,
  playerFor,
});

describe('item worth', () => {
  test('an item saves what the next best the loadout holds for its slot would lose, over every setup wearing it', async () => {
    const c = ctx([pick('a', ANGUISH), pick('b', ANGUISH), pick('c', BONECRUSHER)]);
    const worths = await itemWorths(c, [TBOW, MASK, ANGUISH, BONECRUSHER, DRAGON_ARROW], []);
    // two phases at 1000 / 12 instead of 1000 / 10
    expect(worths[ANGUISH].seconds).toBeCloseTo(2 * (1000 / 10 - 1000 / 12));
    expect(worths[ANGUISH].instead).toBe(BONECRUSHER);
    expect(worths[BONECRUSHER].seconds).toBeCloseTo(0);
  });

  test('a weapon with nothing else in the loadout for its phase is needed outright', async () => {
    const worths = await itemWorths(ctx([pick('a', ANGUISH)]), [TBOW], []);
    expect(worths[TBOW].seconds).toBe(Infinity);
  });

  test('replacements are rated in every setup wearing the item, fastest first, with what the loadout holds marked', async () => {
    const c = ctx([pick('a', BONECRUSHER), pick('b', BONECRUSHER)]);
    const rows = (await itemReplacements(c, BONECRUSHER, [item(ANGUISH), item(BONECRUSHER)], () => 1e6, [TBOW, BONECRUSHER]))!;
    expect(rows[0].id).toBe(ANGUISH);
    expect(rows[0].delta).toBeCloseTo(-2 * (1000 / 10 - 1000 / 12));
    expect(rows.find((r) => r.current)!.id).toBe(BONECRUSHER);
    expect(rows.some((r) => r.id === null)).toBe(true);
    expect(await itemReplacements(c, TBOW, [], () => 0, [])).toBeNull();
  });
});
