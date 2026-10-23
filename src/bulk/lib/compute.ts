/**
 * The bulk calculator's only contact point with the upstream calc engine. This file runs inside the bulk web workers,
 * so it must not import '@/state', React, or anything under src/app.
 */
import merge from 'lodash.mergewith';
import { PartialDeep } from 'type-fest';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { calculateAttackSpeed, calculateEquipmentBonusesFromGear } from '@/lib/Equipment';
import { INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { scaleMonster } from '@/lib/MonsterScaling';
import { MONSTER_PHASES_BY_ID } from '@/lib/constants';
import { FeatureStatus } from '@/utils';
import { Monster } from '@/types/Monster';
import { Player } from '@/types/Player';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';

/**
 * Derive the gear-based stats of a player for a specific monster, as the calculator does when the monster changes.
 */
export const preparePlayer = (player: Player, monster: Monster): Player => {
  const prepared: Player = { ...player, ...calculateEquipmentBonusesFromGear(player, monster) };
  prepared.attackSpeed = calculateAttackSpeed(prepared, monster);
  return prepared;
};

/**
 * Build a monster with inputs, applying the same defaults that the calculator's monster panel applies on selection.
 */
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

export const computeRow = (setup: BulkSetup, entry: BulkMonster): BulkRow => {
  const row: BulkRow = {
    setupId: setup.id,
    monsterId: entry.id,
    maxHit: 0,
    accuracy: 0,
    dps: 0,
    ttk: null,
    spec: null,
    issues: [],
  };

  try {
    const { monster } = entry;
    const player = preparePlayer(setup.player, monster);
    const calc = new PlayerVsNPCCalc(player, monster, {
      loadoutName: setup.id,
      disableMonsterScaling: monster.id === -1,
    });

    const ttk = calc.getTtk();
    row.maxHit = calc.getDistribution().getMax();
    row.accuracy = calc.getDisplayHitChance();
    row.dps = calc.getDps();
    // upstream reports 0 when the setup can't deal damage; treat that as "never", like the calculator's results table
    row.ttk = Number.isFinite(ttk) && ttk > 0 ? ttk : null;

    const specCalc = calc.getSpecCalc();
    if (specCalc) {
      row.spec = {
        maxHit: specCalc.getMax(),
        accuracy: specCalc.getDisplayHitChance(),
        expected: specCalc.getExpectedDamage(),
        dps: specCalc.getSpecDps(),
        partial: calc.isSpecSupported() === FeatureStatus.PARTIALLY_IMPLEMENTED,
      };
    }

    row.issues = [...calc.userIssues, ...(specCalc?.userIssues || [])].map((i) => i.message);
  } catch (e) {
    return {
      ...row,
      maxHit: 0,
      accuracy: 0,
      dps: 0,
      ttk: null,
      spec: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }

  return row;
};
