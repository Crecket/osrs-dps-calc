import { Prayer } from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { BestStyle, PrayerUnlocks } from '@/best/types';

// Worker-safe: no state, React or app imports.

/** Prayer level required, from each prayer's Wiki page */
export const PRAYER_LEVEL: Partial<Record<Prayer, number>> = {
  [Prayer.SHARP_EYE]: 8,
  [Prayer.MYSTIC_WILL]: 9,
  [Prayer.BURST_OF_STRENGTH]: 4,
  [Prayer.CLARITY_OF_THOUGHT]: 7,
  [Prayer.SUPERHUMAN_STRENGTH]: 13,
  [Prayer.IMPROVED_REFLEXES]: 16,
  [Prayer.HAWK_EYE]: 26,
  [Prayer.MYSTIC_LORE]: 27,
  [Prayer.ULTIMATE_STRENGTH]: 31,
  [Prayer.INCREDIBLE_REFLEXES]: 34,
  [Prayer.EAGLE_EYE]: 44,
  [Prayer.MYSTIC_MIGHT]: 45,
  [Prayer.CHIVALRY]: 60,
  [Prayer.DEADEYE]: 62,
  [Prayer.MYSTIC_VIGOUR]: 63,
  [Prayer.PIETY]: 70,
  [Prayer.RIGOUR]: 74,
  [Prayer.AUGURY]: 77,
  [Prayer.ZEAL]: 84,
};

/** Defence level required; prayers not listed have none */
export const DEFENCE_LEVEL: Partial<Record<Prayer, number>> = {
  [Prayer.CHIVALRY]: 65,
  [Prayer.PIETY]: 70,
  [Prayer.RIGOUR]: 70,
  [Prayer.AUGURY]: 70,
};

// strongest first
const RANGED_RANKING = [Prayer.RIGOUR, Prayer.DEADEYE, Prayer.EAGLE_EYE, Prayer.HAWK_EYE, Prayer.SHARP_EYE];
const MAGIC_RANKING = [Prayer.AUGURY, Prayer.MYSTIC_VIGOUR, Prayer.MYSTIC_MIGHT, Prayer.MYSTIC_LORE, Prayer.MYSTIC_WILL];
const MELEE_RANKING = [Prayer.ZEAL, Prayer.PIETY, Prayer.CHIVALRY];
const MELEE_STRENGTH = [Prayer.ULTIMATE_STRENGTH, Prayer.SUPERHUMAN_STRENGTH, Prayer.BURST_OF_STRENGTH];
const MELEE_ATTACK = [Prayer.INCREDIBLE_REFLEXES, Prayer.IMPROVED_REFLEXES, Prayer.CLARITY_OF_THOUGHT];

export type PrayerGroup = 'melee' | 'ranged' | 'magic';
export const PRAYER_GROUPS: PrayerGroup[] = ['melee', 'ranged', 'magic'];

export const prayerGroup = (style: BestStyle): PrayerGroup => (style === 'ranged' || style === 'magic' ? style : 'melee');

/** Whether the prayer is unlocked and the prayer and Defence levels are high enough for it. */
export const canUsePrayer = (p: Prayer, unlocks: PrayerUnlocks, defLevel: number): boolean => {
  const unlocked = (() => {
    switch (p) {
      case Prayer.ZEAL: return unlocks.zeal;
      case Prayer.PIETY: case Prayer.CHIVALRY: return unlocks.piety;
      case Prayer.RIGOUR: return unlocks.rigour;
      case Prayer.AUGURY: return unlocks.augury;
      case Prayer.DEADEYE: return unlocks.deadeye;
      case Prayer.MYSTIC_VIGOUR: return unlocks.mysticVigour;
      default: return true;
    }
  })();
  return unlocked && unlocks.prayerLevel >= (PRAYER_LEVEL[p] ?? 0) && defLevel >= (DEFENCE_LEVEL[p] ?? 0);
};

/**
 * The best offensive prayer(s) for a style given what is unlocked, the prayer level and the Defence level. Melee falls
 * back to the best strength + attack pair when no combined prayer is usable.
 */
export const bestPrayers = (style: BestStyle, unlocks: PrayerUnlocks, defLevel: number): Prayer[] => {
  const usable = (p: Prayer) => canUsePrayer(p, unlocks, defLevel);
  if (style === 'ranged') {
    const p = RANGED_RANKING.find(usable);
    return p === undefined ? [] : [p];
  }
  if (style === 'magic') {
    const p = MAGIC_RANKING.find(usable);
    return p === undefined ? [] : [p];
  }

  const combined = MELEE_RANKING.find(usable);
  if (combined !== undefined) return [combined];
  const pair = [MELEE_STRENGTH.find(usable), MELEE_ATTACK.find(usable)];
  return pair.filter((p): p is Prayer => p !== undefined);
};

/** Whether `prayers` is a combination a player could pray for the group: one ranged or magic prayer; for melee one combined prayer, or at most one strength and one attack prayer. Empty is no prayer. */
export const isPrayerChoice = (group: PrayerGroup, prayers: Prayer[]): boolean => {
  if (group === 'ranged') return prayers.length <= 1 && prayers.every((p) => RANGED_RANKING.includes(p));
  if (group === 'magic') return prayers.length <= 1 && prayers.every((p) => MAGIC_RANKING.includes(p));
  if (prayers.length === 1 && MELEE_RANKING.includes(prayers[0])) return true;
  const strength = prayers.filter((p) => MELEE_STRENGTH.includes(p));
  const attack = prayers.filter((p) => MELEE_ATTACK.includes(p));
  return strength.length <= 1 && attack.length <= 1 && strength.length + attack.length === prayers.length;
};

/**
 * The prayer choices the player can use for the group, strongest first: for melee each combined prayer, the best strength + attack pair, then each strength and each attack prayer on its own.
 */
export const prayerChoices = (group: PrayerGroup, unlocks: PrayerUnlocks, defLevel: number): Prayer[][] => {
  const usable = (p: Prayer) => canUsePrayer(p, unlocks, defLevel);
  if (group === 'ranged') return RANGED_RANKING.filter(usable).map((p) => [p]);
  if (group === 'magic') return MAGIC_RANKING.filter(usable).map((p) => [p]);
  const strength = MELEE_STRENGTH.filter(usable);
  const attack = MELEE_ATTACK.filter(usable);
  return [
    ...MELEE_RANKING.filter(usable).map((p) => [p]),
    ...(strength.length > 0 && attack.length > 0 ? [[strength[0], attack[0]]] : []),
    ...strength.map((p) => [p]),
    ...attack.map((p) => [p]),
  ];
};

/** The prayers a style's setups use: the group's override when the player can use all of it, else bestPrayers (Auto). */
export const stylePrayers = (
  style: BestStyle,
  unlocks: PrayerUnlocks,
  defLevel: number,
  overrides: Partial<Record<PrayerGroup, Prayer[]>> = {},
): Prayer[] => {
  const override = overrides[prayerGroup(style)];
  if (override && override.every((p) => canUsePrayer(p, unlocks, defLevel))) return [...override];
  return bestPrayers(style, unlocks, defLevel);
};

export const defaultPotions = (style: BestStyle): Potion[] => {
  if (style === 'ranged') return [Potion.RANGING];
  if (style === 'magic') return [Potion.SATURATED_HEART];
  return [Potion.SUPER_COMBAT];
};
