import { describe, expect, test } from '@jest/globals';
import { hasGear, newCalculatorSetups } from '@/bulk/lib/calculatorLoadouts';
import { fromCalculatorState, monsterFromSearch } from '@/bulk/lib/presetIO';
import { createEmptyPlayer } from '@/state/PlayerStore';
import { getMonsters } from '@/lib/Monsters';
import { availableEquipment } from '@/lib/Equipment';
import { IMPORT_VERSION, ImportableData } from '@/state/RootStore';
import { Player } from '@/types/Player';

const withWeapon = (name: string, id: number): Player => {
  const p = createEmptyPlayer(name);
  p.equipment.weapon = availableEquipment.find((e) => e.id === id)!;
  return p;
};

const state = (loadouts: Player[]): ImportableData => ({
  serializationVersion: IMPORT_VERSION,
  loadouts,
  selectedLoadout: '',
  monster: monsterFromSearch(getMonsters()[0]).monster,
} as unknown as ImportableData);

describe('newCalculatorSetups', () => {
  test('counts only loadouts not already in the preset', () => {
    const s = state([withWeapon('Whip', 4151), withWeapon('Fang', 26219)]);
    const existing = fromCalculatorState(state([withWeapon('Whip', 4151)]), 'all').setups;

    const fresh = newCalculatorSetups(s, existing);

    expect(fresh.map((x) => x.name)).toEqual(['Fang']);
  });

  test('null or empty state gives none', () => {
    expect(newCalculatorSetups(null, [])).toEqual([]);
    expect(newCalculatorSetups(state([]), [])).toEqual([]);
  });

  test('unmigratable state gives none', () => {
    expect(newCalculatorSetups({ loadouts: [null] } as unknown as ImportableData, [])).toEqual([]);
  });

  test('gearless loadouts are ignored', () => {
    expect(newCalculatorSetups(state([createEmptyPlayer('Loadout 1')]), [])).toEqual([]);
  });
});

describe('hasGear', () => {
  test('true only with something equipped', () => {
    expect(hasGear(createEmptyPlayer())).toBe(false);
    expect(hasGear(withWeapon('Whip', 4151))).toBe(true);
  });
});
