import { describe, expect, test } from '@jest/globals';
import {
  buySpecWeapons, planRoomSpecs, roomEnergy, SpecOption,
} from '@/raid/lib/specs';

const ZCB = 26374;
const KISTEN = 33631;
const CLAWS = 13652;

const option = (weaponId: number, cost: number, expected: number, phaseKey = 'p0', mainDps = 10, attackSeconds = 3): SpecOption => ({
  weaponId, cost, phaseKey, expected, mainDps, attackSeconds,
});

describe('roomEnergy', () => {
  test('100% minus the defence specs: maul and DWH 50%, Ralos 25% per hitsplat', () => {
    expect(roomEnergy([{ elderMaul: 0, dwh: 0, tonalztic: 0 }])).toBe(100);
    expect(roomEnergy([{ elderMaul: 2, dwh: 0, tonalztic: 4 }])).toBe(0);
    expect(roomEnergy([{ elderMaul: 1, dwh: 0, tonalztic: 0 }, { elderMaul: 0, dwh: 0, tonalztic: 1 }])).toBe(25);
  });
});

describe('planRoomSpecs', () => {
  test('a spec saves its damage over the main DPS minus its own attack time', () => {
    // 60 expected at 10 DPS saves 6 s, minus a 3 s attack = 3 s
    const room = planRoomSpecs(100, [option(ZCB, 75, 60)], new Set([ZCB]));
    expect(room.picks).toEqual([{ weaponId: ZCB, phaseKey: 'p0', count: 1, seconds: 3 }]);
    expect(room.seconds).toBeCloseTo(3);
  });

  test('picks the best mix for the energy', () => {
    // 100%: two kisten specs (2 × 2 s) beat one ZCB spec (3 s) with 25% left over
    const room = planRoomSpecs(100, [option(ZCB, 75, 60), option(KISTEN, 50, 50)], new Set([ZCB, KISTEN]));
    expect(room.picks).toEqual([{ weaponId: KISTEN, phaseKey: 'p0', count: 2, seconds: 4 }]);
  });

  test('uses only weapons the loadout holds, and nothing that loses time', () => {
    expect(planRoomSpecs(100, [option(ZCB, 75, 60)], new Set()).picks).toEqual([]);
    expect(planRoomSpecs(100, [option(CLAWS, 50, 20)], new Set([CLAWS])).picks).toEqual([]);
  });

  test('specs on the phase where they save the most', () => {
    const room = planRoomSpecs(50, [option(KISTEN, 50, 50, 'bork'), option(KISTEN, 50, 50, 'smorks', 5)], new Set([KISTEN]));
    expect(room.picks).toEqual([{ weaponId: KISTEN, phaseKey: 'smorks', count: 1, seconds: 7 }]);
  });

  test('no energy, no specs', () => {
    expect(planRoomSpecs(0, [option(KISTEN, 50, 50)], new Set([KISTEN])).seconds).toBe(0);
  });
});

describe('buySpecWeapons', () => {
  const rooms = [
    { bossId: 'a', energy: 100, options: [option(ZCB, 75, 60), option(KISTEN, 50, 50)] },
    { bossId: 'b', energy: 100, options: [option(ZCB, 75, 90, 'p1')] },
  ];

  test('buys the spec weapons that save the most per GP while budget and slots allow', () => {
    const prices: Record<number, number> = { [ZCB]: 300, [KISTEN]: 100 };
    const bought = buySpecWeapons(rooms, [], (id) => prices[id], 1000, 2);
    expect(bought.sort()).toEqual([KISTEN, ZCB].sort());
    expect(buySpecWeapons(rooms, [], (id) => prices[id], 1000, 1)).toHaveLength(1);
    expect(buySpecWeapons(rooms, [], (id) => prices[id], 200, 2)).toEqual([KISTEN]);
  });

  test('a weapon already held is not bought again', () => {
    expect(buySpecWeapons(rooms, [ZCB, KISTEN], () => 1, 1000, 2)).toEqual([]);
  });
});
