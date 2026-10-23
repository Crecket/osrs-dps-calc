import { Player } from '@/types/Player';
import { BulkSetup, GEAR_SLOT_ORDER } from '@/bulk/types';

/**
 * A key that is equal for two players exactly when they calculate identically: the name and the stats the calculator
 * derives from gear (bonuses, attack speed) don't count.
 */
export const setupKey = (player: Player): string => JSON.stringify({
  equipment: GEAR_SLOT_ORDER.map((slot) => player.equipment[slot]?.id ?? null),
  // the blowpipe's darts live on the weapon; the dart name is derived from the id, and its key order varies
  dart: player.equipment.weapon?.itemVars?.blowpipeDartId ?? null,
  skills: player.skills,
  boosts: player.boosts,
  prayers: [...player.prayers].sort((a, b) => a - b),
  style: [player.style.name, player.style.type, player.style.stance],
  spell: player.spell?.name ?? null,
  buffs: { ...player.buffs, potions: [...player.buffs.potions].sort((a, b) => a - b) },
});

/**
 * The candidates that aren't already in `existing`, and aren't repeated earlier in `candidates`.
 */
export const uniqueNewSetups = (candidates: BulkSetup[], existing: BulkSetup[]): BulkSetup[] => {
  const seen = new Set(existing.map((s) => setupKey(s.player)));
  return candidates.filter((s) => {
    const key = setupKey(s.player);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
