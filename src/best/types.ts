import { PlayerSkills } from '@/types/Player';
import Potion from '@/enums/Potion';
import { Prayer } from '@/enums/Prayer';

export type BestStyle = 'stab' | 'slash' | 'crush' | 'ranged' | 'magic';
export const BEST_STYLES: BestStyle[] = ['stab', 'slash', 'crush', 'ranged', 'magic'];

/** What the player has unlocked. `piety` covers Chivalry too. */
export interface PrayerUnlocks {
  prayerLevel: number;
  piety: boolean;
  rigour: boolean;
  augury: boolean;
  deadeye: boolean;
  mysticVigour: boolean;
  zeal: boolean;
}

/** Buffs that change which gear wins; they become player buffs in the base player. */
export interface CombatConditions {
  onSlayerTask: boolean;
  inWilderness: boolean;
  chargeSpell: boolean;
  markOfDarknessSpell: boolean;
  forinthrySurge: boolean;
  kandarinDiary: boolean;
  soulreaperStacks: number;
  /** null = max HP */
  currentHp: number | null;
}

export interface BestInputs {
  skills: PlayerSkills;
  unlocks: PrayerUnlocks;
  conditions: CombatConditions;
  /** Per style group; a missing group uses the default potion */
  potions: Partial<Record<'melee' | 'ranged' | 'magic', Potion[]>>;
  styles: BestStyle[];
  topN: number;
  /** Per prayer group: the prayers to use instead of the best usable ones; a missing group is Auto, [] is no prayer */
  prayerOverrides?: Partial<Record<'melee' | 'ranged' | 'magic', Prayer[]>>;
  /** Canonical ids of items the search must not use */
  excludedItemIds?: number[];
}

// not on slayer task: upstream defaults to on, which would make the slayer helm win every boss
export const DEFAULT_CONDITIONS: CombatConditions = {
  onSlayerTask: false,
  inWilderness: false,
  chargeSpell: false,
  markOfDarknessSpell: false,
  forinthrySurge: false,
  kandarinDiary: true,
  soulreaperStacks: 5,
  currentHp: null,
};

export const DEFAULT_UNLOCKS: PrayerUnlocks = {
  prayerLevel: 99,
  piety: true,
  rigour: true,
  augury: true,
  deadeye: true,
  mysticVigour: true,
  zeal: true,
};
