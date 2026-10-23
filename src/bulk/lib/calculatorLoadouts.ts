import { Player } from '@/types/Player';
import { ImportableData } from '@/types/State';
import { BulkSetup, GEAR_SLOT_ORDER } from '@/bulk/types';
import { fromCalculatorState } from '@/bulk/lib/presetIO';
import { uniqueNewSetups } from '@/bulk/lib/dedupe';

// the calculator always has at least one loadout, often a blank one that is never worth adding
export const hasGear = (player: Player): boolean => GEAR_SLOT_ORDER.some((slot) => !!player.equipment[slot]);

/**
 * The calculator's saved loadouts that have gear and aren't in `existing` yet.
 */
export const newCalculatorSetups = (state: ImportableData | null, existing: BulkSetup[]): BulkSetup[] => {
  if (!state?.loadouts?.length) return [];
  try {
    const { setups } = fromCalculatorState(state, 'all');
    return uniqueNewSetups(setups.filter((s) => hasGear(s.player)), existing);
  } catch (e) {
    return [];
  }
};
