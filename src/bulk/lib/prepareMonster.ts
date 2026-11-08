/** Apart from compute.ts, which the workers load: this needs '@/lib/Monsters', and with it the whole monster list. */
import merge from 'lodash.mergewith';
import { PartialDeep } from 'type-fest';
import { INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { scaleMonster } from '@/lib/MonsterScaling';
import { MONSTER_PHASES_BY_ID } from '@/lib/constants';
import { Monster } from '@/types/Monster';

/**
 * Build a monster with inputs, applying the same defaults that the calculator's monster panel applies on selection.
 */
// eslint-disable-next-line import/prefer-default-export
export const prepareMonster = (base: Omit<Monster, 'inputs'>, inputs: PartialDeep<Monster['inputs']> = {}): Monster => {
  const monster: Monster = {
    ...base,
    inputs: merge({}, INITIAL_MONSTER_INPUTS, inputs),
  };

  if (monster.inputs.phase === undefined) {
    monster.inputs.phase = MONSTER_PHASES_BY_ID[base.id]?.[0];
  }
  if (inputs.monsterCurrentHp === undefined) {
    monster.inputs.monsterCurrentHp = scaleMonster(monster).skills.hp;
  }

  return monster;
};
