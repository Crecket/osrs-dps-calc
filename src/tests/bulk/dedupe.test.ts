import { describe, expect, test } from '@jest/globals';
import { setupKey, uniqueNewSetups } from '@/bulk/lib/dedupe';
import { BulkSetup } from '@/bulk/types';
import { generateEmptyPlayer } from '@/state';
import { availableEquipment } from '@/lib/Equipment';
import { Prayer } from '@/enums/Prayer';
import { Player } from '@/types/Player';

const whip = availableEquipment.find((e) => e.id === 4151)!;
const fang = availableEquipment.find((e) => e.id === 26219)!;

const player = (name: string, edit: (p: Player) => void = () => {}): Player => {
  const p = generateEmptyPlayer(name);
  p.equipment.weapon = whip;
  edit(p);
  return p;
};

let n = 0;
const setup = (p: Player): BulkSetup => {
  n += 1;
  return { id: `id${n}`, name: `name${n}`, player: p };
};

describe('setupKey', () => {
  test('same gear and settings with a different name is a duplicate', () => {
    expect(setupKey(player('A'))).toBe(setupKey(player('B')));
  });

  test('a different prayer, style or item is not a duplicate', () => {
    const base = setupKey(player('A'));
    expect(setupKey(player('A', (p) => { p.prayers = [Prayer.PIETY]; }))).not.toBe(base);
    expect(setupKey(player('A', (p) => { p.style = { ...p.style, name: 'Lash' }; }))).not.toBe(base);
    expect(setupKey(player('A', (p) => { p.equipment.weapon = fang; }))).not.toBe(base);
  });

  test("prayer order doesn't matter", () => {
    expect(setupKey(player('A', (p) => { p.prayers = [Prayer.PIETY, Prayer.STEEL_SKIN]; })))
      .toBe(setupKey(player('A', (p) => { p.prayers = [Prayer.STEEL_SKIN, Prayer.PIETY]; })));
  });

  test('derived stats are ignored', () => {
    expect(setupKey(player('A', (p) => { p.attackSpeed = 99; p.bonuses.str = 123; }))).toBe(setupKey(player('A')));
  });
});

describe('uniqueNewSetups', () => {
  test('drops setups already present and repeats within the batch', () => {
    const a = player('A');
    const b = player('B', (p) => { p.equipment.weapon = fang; });
    const existing = [setup(a)];
    const candidates = [setup(player('A2')), setup(b), setup(player('B2', (p) => { p.equipment.weapon = fang; }))];

    expect(uniqueNewSetups(candidates, existing)).toEqual([candidates[1]]);
  });
});
