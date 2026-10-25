import { describe, expect, test } from '@jest/globals';
import { groupByWeapon } from '@/best/lib/groups';
import { defaultSort } from '@/bulk/lib/table';
import { BulkRow, BulkSetup } from '@/bulk/types';
import { generateEmptyPlayer } from '@/state';
import { findEquipment } from '@/tests/utils/TestUtils';

const whip = findEquipment('Abyssal whip');
const rapier = findEquipment('Ghrazi rapier');
const ultor = findEquipment('Ultor ring');
const torture = findEquipment('Amulet of torture');

const setup = (id: string, weapon: typeof whip, ring: typeof whip | null, neck: typeof whip | null = torture): BulkSetup => {
  const player = generateEmptyPlayer(id);
  player.equipment.weapon = weapon;
  player.equipment.ring = ring;
  player.equipment.neck = neck;
  return { id, name: id, player };
};
const row = (setupId: string, dps: number, maxHit = 40): BulkRow => ({
  setupId, monsterId: 'm', maxHit, accuracy: 0.8, dps, ttk: 30, spec: null, issues: [],
});

describe('groupByWeapon', () => {
  const setups = [setup('a', whip, ultor), setup('b', rapier, ultor), setup('c', whip, null, null)];
  const rows = [row('a', 7.5, 30), row('b', 7.2, 50), row('c', 7.3, 20)];

  test('one group per weapon in sort order, its other rows as alternatives with what they swap in', () => {
    const groups = groupByWeapon(rows, setups, defaultSort('normal'));
    expect(groups.map((g) => [g.weaponId, g.lead.setupId])).toEqual([[whip.id, 'a'], [rapier.id, 'b']]);
    expect(groups[0].alternatives.map((a) => [a.row.setupId, a.slots, a.label])).toEqual([['c', ['neck', 'ring'], 'With no amulet, no ring']]);
    expect(groups[1].alternatives).toEqual([]);
  });

  test('the lead is the first row of its weapon in the current sort', () => {
    const groups = groupByWeapon(rows, setups, { key: 'maxHit', dir: 'desc' });
    expect(groups.map((g) => g.lead.setupId)).toEqual(['b', 'a']);
    expect(groups[1].alternatives.map((a) => a.row.setupId)).toEqual(['c']);
  });
});
