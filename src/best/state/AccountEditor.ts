import { createContext, useContext } from 'react';
import Potion from '@/enums/Potion';
import { Prayer } from '@/enums/Prayer';
import { PlayerSkills } from '@/types/Player';
import { AccountInputs, CombatConditions, PrayerUnlocks } from '@/best/types';
import { PrayerGroup } from '@/best/lib/loadout';
import { useBestStore } from '@/best/state/BestStore';

/** What the account fields read and change: the best setup store, or the raid store */
export interface AccountEditor {
  inputs: AccountInputs;
  setSkills(s: Partial<PlayerSkills>): void;
  setUnlocks(u: Partial<PrayerUnlocks>): void;
  setConditions(c: Partial<CombatConditions>): void;
  setPotions(group: 'melee' | 'ranged' | 'magic', p: Potion[] | null): void;
  setPrayerOverride(group: PrayerGroup, prayers: Prayer[] | null): void;
}

export const AccountEditorContext = createContext<AccountEditor | null>(null);

/** The provided editor, else the best setup store */
export const useAccountEditor = (): AccountEditor => {
  const best = useBestStore();
  return useContext(AccountEditorContext) ?? best;
};
