import { describe, expect, test } from '@jest/globals';
import { Prayer } from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { DEFAULT_CONDITIONS, DEFAULT_UNLOCKS, BestInputs } from '@/best/types';
import {
  bestPrayers, defaultPotions, isPrayerChoice, prayerChoices, stylePrayers,
} from '@/best/lib/loadout';
import { basePlayer } from '@/best/lib/basePlayer';

const skills99 = {
  atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
};

describe('bestPrayers', () => {
  test('melee ranks Zeal > Piety > Chivalry > arm+brain pair', () => {
    expect(bestPrayers('slash', DEFAULT_UNLOCKS, 99)).toEqual([Prayer.ZEAL]);
    expect(bestPrayers('slash', { ...DEFAULT_UNLOCKS, zeal: false }, 99)).toEqual([Prayer.PIETY]);
    expect(bestPrayers('slash', { ...DEFAULT_UNLOCKS, zeal: false, piety: false }, 99))
      .toEqual([Prayer.ULTIMATE_STRENGTH, Prayer.INCREDIBLE_REFLEXES]);
    expect(bestPrayers('slash', { ...DEFAULT_UNLOCKS, prayerLevel: 1 }, 99)).toEqual([]);
  });

  test('ranged ranks Rigour > Deadeye > Eagle Eye > Hawk Eye', () => {
    expect(bestPrayers('ranged', DEFAULT_UNLOCKS, 99)).toEqual([Prayer.RIGOUR]);
    expect(bestPrayers('ranged', { ...DEFAULT_UNLOCKS, rigour: false }, 99)).toEqual([Prayer.DEADEYE]);
    expect(bestPrayers('ranged', { ...DEFAULT_UNLOCKS, rigour: false, deadeye: false }, 99)).toEqual([Prayer.EAGLE_EYE]);
    expect(bestPrayers('ranged', { ...DEFAULT_UNLOCKS, prayerLevel: 43 }, 99)).toEqual([Prayer.HAWK_EYE]);
  });

  test('magic ranks Augury > Mystic Vigour > Mystic Might', () => {
    expect(bestPrayers('magic', DEFAULT_UNLOCKS, 99)).toEqual([Prayer.AUGURY]);
    expect(bestPrayers('magic', { ...DEFAULT_UNLOCKS, augury: false }, 99)).toEqual([Prayer.MYSTIC_VIGOUR]);
    expect(bestPrayers('magic', { ...DEFAULT_UNLOCKS, augury: false, mysticVigour: false }, 99)).toEqual([Prayer.MYSTIC_MIGHT]);
  });

  test('defence requirements gate Piety, Chivalry, Rigour and Augury', () => {
    const noZeal = { ...DEFAULT_UNLOCKS, zeal: false };
    expect(bestPrayers('slash', noZeal, 69)).toEqual([Prayer.CHIVALRY]);
    expect(bestPrayers('slash', noZeal, 64)).toEqual([Prayer.ULTIMATE_STRENGTH, Prayer.INCREDIBLE_REFLEXES]);
    expect(bestPrayers('ranged', DEFAULT_UNLOCKS, 69)).toEqual([Prayer.DEADEYE]);
    expect(bestPrayers('magic', DEFAULT_UNLOCKS, 69)).toEqual([Prayer.MYSTIC_VIGOUR]);
  });
});

describe('prayer choices', () => {
  const pure = { ...DEFAULT_UNLOCKS, prayerLevel: 31 };

  test('low prayer levels: a partial or mixed melee pair, Sharp Eye, Mystic Will and Mystic Lore', () => {
    const at = (prayerLevel: number) => ({ ...DEFAULT_UNLOCKS, prayerLevel });
    expect(bestPrayers('slash', at(5), 1)).toEqual([Prayer.BURST_OF_STRENGTH]);
    expect(bestPrayers('slash', at(15), 1)).toEqual([Prayer.SUPERHUMAN_STRENGTH, Prayer.CLARITY_OF_THOUGHT]);
    expect(bestPrayers('ranged', at(8), 1)).toEqual([Prayer.SHARP_EYE]);
    expect(bestPrayers('magic', at(9), 1)).toEqual([Prayer.MYSTIC_WILL]);
    expect(bestPrayers('magic', at(27), 1)).toEqual([Prayer.MYSTIC_LORE]);
  });

  test('a level 31 pure gets Ultimate Strength + Improved Reflexes on Auto', () => {
    expect(bestPrayers('slash', pure, 1)).toEqual([Prayer.ULTIMATE_STRENGTH, Prayer.IMPROVED_REFLEXES]);
    expect(stylePrayers('slash', pure, 1)).toEqual([Prayer.ULTIMATE_STRENGTH, Prayer.IMPROVED_REFLEXES]);
  });

  test('melee choices: combined prayers, the best pair, then each strength and attack prayer', () => {
    expect(prayerChoices('melee', pure, 1)).toEqual([
      [Prayer.ULTIMATE_STRENGTH, Prayer.IMPROVED_REFLEXES],
      [Prayer.ULTIMATE_STRENGTH], [Prayer.SUPERHUMAN_STRENGTH], [Prayer.BURST_OF_STRENGTH],
      [Prayer.IMPROVED_REFLEXES], [Prayer.CLARITY_OF_THOUGHT],
    ]);
    expect(prayerChoices('melee', DEFAULT_UNLOCKS, 99).slice(0, 4)).toEqual([
      [Prayer.ZEAL], [Prayer.PIETY], [Prayer.CHIVALRY], [Prayer.ULTIMATE_STRENGTH, Prayer.INCREDIBLE_REFLEXES],
    ]);
    expect(prayerChoices('ranged', pure, 1)).toEqual([[Prayer.HAWK_EYE], [Prayer.SHARP_EYE]]);
    expect(prayerChoices('magic', { ...DEFAULT_UNLOCKS, prayerLevel: 8 }, 1)).toEqual([]);
  });

  test('an override is used as-is, [] is no prayer, an unusable one falls back to Auto', () => {
    expect(stylePrayers('slash', pure, 1, { melee: [Prayer.SUPERHUMAN_STRENGTH] })).toEqual([Prayer.SUPERHUMAN_STRENGTH]);
    expect(stylePrayers('slash', pure, 1, { melee: [] })).toEqual([]);
    // Piety needs 70 Prayer
    expect(stylePrayers('slash', pure, 1, { melee: [Prayer.PIETY] })).toEqual([Prayer.ULTIMATE_STRENGTH, Prayer.IMPROVED_REFLEXES]);
    // another group's override doesn't apply
    expect(stylePrayers('ranged', pure, 1, { melee: [] })).toEqual([Prayer.HAWK_EYE]);
  });

  test('isPrayerChoice accepts only combinations of the group', () => {
    expect(isPrayerChoice('melee', [Prayer.ULTIMATE_STRENGTH, Prayer.IMPROVED_REFLEXES])).toBe(true);
    expect(isPrayerChoice('melee', [Prayer.PIETY])).toBe(true);
    expect(isPrayerChoice('melee', [])).toBe(true);
    expect(isPrayerChoice('melee', [Prayer.PIETY, Prayer.ULTIMATE_STRENGTH])).toBe(false);
    expect(isPrayerChoice('melee', [Prayer.ULTIMATE_STRENGTH, Prayer.SUPERHUMAN_STRENGTH])).toBe(false);
    expect(isPrayerChoice('melee', [Prayer.RIGOUR])).toBe(false);
    expect(isPrayerChoice('ranged', [Prayer.RIGOUR])).toBe(true);
    expect(isPrayerChoice('magic', [Prayer.RIGOUR])).toBe(false);
  });
});

describe('defaultPotions', () => {
  test('one potion per group', () => {
    expect(defaultPotions('stab')).toEqual([Potion.SUPER_COMBAT]);
    expect(defaultPotions('crush')).toEqual([Potion.SUPER_COMBAT]);
    expect(defaultPotions('ranged')).toEqual([Potion.RANGING]);
    expect(defaultPotions('magic')).toEqual([Potion.SATURATED_HEART]);
  });
});

describe('basePlayer', () => {
  const inputs: BestInputs = {
    skills: skills99,
    unlocks: DEFAULT_UNLOCKS,
    conditions: DEFAULT_CONDITIONS,
    potions: {},
    styles: ['ranged'],
    topN: 5,
  };

  test('ranged base player', () => {
    const p = basePlayer(inputs, 'ranged');
    expect(p.prayers).toEqual([Prayer.RIGOUR]);
    expect(p.buffs.onSlayerTask).toBe(false);
    expect(p.boosts.ranged).toBe(13);
    expect(Object.values(p.equipment).every((e) => e === null)).toBe(true);
  });

  test('potion overrides and current HP', () => {
    const p = basePlayer({ ...inputs, potions: { ranged: [Potion.SUPER_RANGING] }, conditions: { ...DEFAULT_CONDITIONS, currentHp: 50 } }, 'ranged');
    expect(p.buffs.potions).toEqual([Potion.SUPER_RANGING]);
    expect(p.boosts.hp).toBe(-49);
  });

  test('prayer overrides: used as-is per group, [] is none, Auto without one', () => {
    const pure = { ...inputs, unlocks: { ...DEFAULT_UNLOCKS, prayerLevel: 31 }, skills: { ...skills99, def: 1 } };
    expect(basePlayer(pure, 'slash').prayers).toEqual([Prayer.ULTIMATE_STRENGTH, Prayer.IMPROVED_REFLEXES]);
    expect(basePlayer({ ...pure, prayerOverrides: { melee: [Prayer.SUPERHUMAN_STRENGTH] } }, 'crush').prayers).toEqual([Prayer.SUPERHUMAN_STRENGTH]);
    expect(basePlayer({ ...pure, prayerOverrides: { ranged: [] } }, 'ranged').prayers).toEqual([]);
  });

  test('current HP above Hitpoints counts as full HP', () => {
    const p = basePlayer({
      ...inputs, skills: { ...inputs.skills, hp: 70 }, conditions: { ...DEFAULT_CONDITIONS, currentHp: 99 },
    }, 'ranged');
    expect(p.boosts.hp).toBe(0);
  });
});
