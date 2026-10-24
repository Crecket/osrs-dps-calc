import { describe, expect, test } from '@jest/globals';
import { Prayer } from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { DEFAULT_CONDITIONS, DEFAULT_UNLOCKS, BestInputs } from '@/best/types';
import { bestPrayers, defaultPotions } from '@/best/lib/loadout';
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

  test('current HP above Hitpoints counts as full HP', () => {
    const p = basePlayer({
      ...inputs, skills: { ...inputs.skills, hp: 70 }, conditions: { ...DEFAULT_CONDITIONS, currentHp: 99 },
    }, 'ranged');
    expect(p.boosts.hp).toBe(0);
  });
});
