import { Prayer } from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { BestStyle, PrayerUnlocks } from '@/best/types';

// Worker-safe: no state, React or app imports.

/** Prayer level required, from each prayer's Wiki page */
const PRAYER_LEVEL: Partial<Record<Prayer, number>> = {
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
const DEFENCE_LEVEL: Partial<Record<Prayer, number>> = {
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

/**
 * The best offensive prayer(s) for a style given what is unlocked, the prayer level and the Defence level. Melee falls
 * back to the best strength + attack pair when no combined prayer is usable.
 */
export const bestPrayers = (style: BestStyle, unlocks: PrayerUnlocks, defLevel: number): Prayer[] => {
  const unlocked = (p: Prayer): boolean => {
    switch (p) {
      case Prayer.ZEAL: return unlocks.zeal;
      case Prayer.PIETY: case Prayer.CHIVALRY: return unlocks.piety;
      case Prayer.RIGOUR: return unlocks.rigour;
      case Prayer.AUGURY: return unlocks.augury;
      case Prayer.DEADEYE: return unlocks.deadeye;
      case Prayer.MYSTIC_VIGOUR: return unlocks.mysticVigour;
      default: return true;
    }
  };
  const usable = (p: Prayer): boolean => unlocked(p)
    && unlocks.prayerLevel >= (PRAYER_LEVEL[p] ?? 0)
    && defLevel >= (DEFENCE_LEVEL[p] ?? 0);

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

export const defaultPotions = (style: BestStyle): Potion[] => {
  if (style === 'ranged') return [Potion.RANGING];
  if (style === 'magic') return [Potion.SATURATED_HEART];
  return [Potion.SUPER_COMBAT];
};
