import { generateEmptyPlayer } from '@/state';
import { Player } from '@/types/Player';
import { potionBoosts } from '@/bulk/lib/filters';
import { BestInputs, BestStyle } from '@/best/types';
import { allUnlocked, defaultPotions, stylePrayers } from '@/best/lib/loadout';

/** The naked player the search dresses: skills, prayers, potions and conditions for one style, no equipment. */
// eslint-disable-next-line import/prefer-default-export
export const basePlayer = (inputs: BestInputs, style: BestStyle): Player => {
  const player = generateEmptyPlayer();
  const { conditions } = inputs;
  player.skills = { ...inputs.skills };
  // saved unlocks from older versions are ignored: only the levels limit the prayers
  player.prayers = stylePrayers(style, allUnlocked(inputs.unlocks), inputs.skills.def, inputs.prayerOverrides);

  const group = style === 'ranged' || style === 'magic' ? style : 'melee';
  const potions = inputs.potions[group] ?? defaultPotions(style);
  player.buffs = {
    ...player.buffs,
    potions,
    onSlayerTask: conditions.onSlayerTask,
    inWilderness: conditions.inWilderness,
    chargeSpell: conditions.chargeSpell,
    markOfDarknessSpell: conditions.markOfDarknessSpell,
    forinthrySurge: conditions.forinthrySurge,
    kandarinDiary: conditions.kandarinDiary,
    soulreaperStacks: conditions.soulreaperStacks,
  };
  player.boosts = { ...player.boosts, ...potionBoosts(potions, player.skills) };
  // the engine reads current HP as skill + boost; a current HP above Hitpoints (left over from a higher level) is full HP
  if (conditions.currentHp !== null) player.boosts.hp = Math.min(conditions.currentHp, player.skills.hp) - player.skills.hp;
  return player;
};
