import { describe, expect, test } from '@jest/globals';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { findEquipment, getTestMonster, getTestPlayer } from '@/tests/utils/TestUtils';

describe('minAttackSpeed', () => {
  test('a fight that leaves no time for fast weapons slows them to the floor, and leaves slower ones alone', () => {
    const dps = (weapon: string, minAttackSpeed?: number) => {
      const monster = getTestMonster('Abyssal demon', 'Standard', { inputs: { minAttackSpeed } });
      const player = getTestPlayer(monster, { equipment: { weapon: findEquipment(weapon) } });
      const calc = new PlayerVsNPCCalc(player, monster);
      return { dps: calc.getDps(), speed: calc.getAttackSpeed() };
    };
    const whip = dps('Abyssal whip');
    const slowed = dps('Abyssal whip', 5);
    expect(slowed.speed).toBe(5);
    expect(slowed.dps).toBeCloseTo((whip.dps * whip.speed) / 5);
    expect(dps('Abyssal whip', 3)).toEqual(whip);
  });
});
