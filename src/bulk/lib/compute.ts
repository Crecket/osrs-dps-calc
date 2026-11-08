/**
 * The bulk calculator's only contact point with the upstream calc engine. This file runs inside the bulk web workers,
 * so it must not import '@/state', React, anything under src/app, or '@/lib/Monsters' (a megabyte of monsters per worker).
 */
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { calculateAttackSpeed, calculateEquipmentBonusesFromGear } from '@/lib/Equipment';
import { scaleMonster } from '@/lib/MonsterScaling';
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

// scaling depends on the monster only, so it is done once per monster instead of once per evaluation. The cache is keyed
// by object identity: callers must pass a new monster object when its inputs change, never mutate one in place.
const scaledMonsters = new WeakMap<Monster, Monster>();
/** The monster as the engine scales it; custom monsters (id -1) aren't scaled. For an engine with scaling disabled. */
export const scaledMonster = (monster: Monster): Monster => {
  let result = scaledMonsters.get(monster);
  if (!result) {
    result = monster.id === -1 ? monster : scaleMonster(monster);
    scaledMonsters.set(monster, result);
  }
  return result;
};

/**
 * Part of a row, for callers that need nothing else: the kill time alone takes 30 to 700 times as long as the DPS (its
 * hits-to-kill table grows with the monster's HP and the max hit), so a rater shouldn't wait for one it won't read.
 */
export type RowPart = 'dps' | 'spec';

/** @param only compute just this part; the row's other numbers stay 0 or null */
export const computeRow = (setup: BulkSetup, entry: BulkMonster, only?: RowPart): BulkRow => {
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
    // only the DPS can use the cached scaling: a spec may scale the monster it was given again (the Tonalztics' second hit),
    // which goes wrong on an already scaled one. Kill times take so long that scaling them once more doesn't matter
    const calc = only === 'dps'
      ? new PlayerVsNPCCalc(player, scaledMonster(monster), { loadoutName: setup.id, disableMonsterScaling: true })
      : new PlayerVsNPCCalc(player, monster, { loadoutName: setup.id, disableMonsterScaling: monster.id === -1 });

    if (only === undefined) {
      const ttk = calc.getTtk();
      row.maxHit = calc.getDistribution().getMax();
      row.accuracy = calc.getDisplayHitChance();
      // upstream reports 0 when the setup can't deal damage; treat that as "never", like the calculator's results table
      row.ttk = Number.isFinite(ttk) && ttk > 0 ? ttk : null;
    }
    if (only !== 'spec') row.dps = calc.getDps();

    const specCalc = only === 'dps' ? null : calc.getSpecCalc();
    if (specCalc) {
      row.spec = {
        maxHit: specCalc.getMax(),
        accuracy: specCalc.getDisplayHitChance(),
        expected: specCalc.getExpectedDamage(),
        dps: specCalc.getDps(),
        regenDps: specCalc.getSpecDps(),
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
