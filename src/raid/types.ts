import { BulkMonster } from '@/bulk/types';
import type { BestStyle } from '@/best/types';

// Worker-safe: no state, React or app imports.

/** The defence-reducing special attacks a boss's counters cover */
export type DefenceWeapon = 'elderMaul' | 'dwh' | 'tonalztic';
export const DEFENCE_WEAPONS: DefenceWeapon[] = ['elderMaul', 'dwh', 'tonalztic'];
export const DEFENCE_WEAPON_IDS: Record<DefenceWeapon, number> = { elderMaul: 21003, dwh: 13576, tonalztic: 28922 };
export const DEFENCE_WEAPON_NAMES: Record<DefenceWeapon, string> = { elderMaul: 'Elder maul', dwh: 'Dragon warhammer', tonalztic: 'Tonalztics of Ralos' };

export type DefenceCounts = Record<DefenceWeapon, number>;

/** Thralls need Arceuus (Book of the Dead + rune pouch); the others choose which spells the magic switch may cast */
export type MagicOption = 'thralls' | 'ancients' | 'standard' | 'none';

/** One health bar: a monster version and the specs that land on it before the fight */
export interface RaidPhase {
  /** Unique in the raid, `<boss id>:<n>` */
  key: string;
  label: string;
  monsterId: number;
  version: string;
  defaults: DefenceCounts;
  /** Styles that can hit this phase; missing means every style */
  allowedStyles?: BestStyle[];
  /** Shares of the health bar that only some styles can deal; missing means one setup does it all */
  parts?: PhasePart[];
  /** The share of the monster's health dealt in this phase, when one monster is fought in several states */
  hpShare?: number;
  /** The monster in this state, where the data has one version for all of them */
  state?: {
    flatArmour?: number;
    /** Every hit lands (a stunned boss): no Defence level or defence bonuses */
    alwaysHit?: boolean;
  };
}

/** A share of a health bar, dealt by the fastest setup of `styles` (any style when missing) */
export interface PhasePart {
  styles?: BestStyle[];
  share: number;
}

export interface BossRules {
  /** Items the loadout must hold for this boss, unless excluded */
  requiredItemIds?: number[];
  /** Magic options this boss can't be done with */
  forbiddenMagic?: { options: MagicOption[]; reason: string };
}

export interface RaidBoss {
  id: string;
  name: string;
  phases: RaidPhase[];
  rules?: BossRules;
}

/** A point in the raid where the party picks one of the options */
export interface RaidStop {
  id: string;
  label: string;
  options: RaidBoss[];
}

export interface RaidDef {
  id: string;
  name: string;
  stops: RaidStop[];
  defaultRoute: Route;
}

/** Stop id -> boss id; a missing or unknown choice is the stop's first option */
export type Route = Record<string, string>;

export interface RoutePhase {
  boss: RaidBoss;
  phase: RaidPhase;
  monster: BulkMonster;
  counts: DefenceCounts;
}
