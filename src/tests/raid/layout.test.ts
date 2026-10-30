import { describe, expect, test } from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { generateEmptyPlayer } from '@/state';
import { buildPlayer } from '@/best/lib/search';
import { BulkSetup } from '@/bulk/types';
import { freeSwitchSlots, layoutLoadout } from '@/raid/lib/layout';

const tbow = availableEquipment.find((e) => e.id === 20997)!;
const rapid = getCombatStylesForCategory(tbow.category).find((s) => s.stance === 'Rapid')!;
const setup = (gear: Record<string, number>): BulkSetup => ({
  id: 'main',
  name: 'main',
  player: buildPlayer(generateEmptyPlayer(), {
    style: 'ranged', weaponId: 20997, combatStyle: rapid, ammoId: 11212, spellName: null, dartId: null,
  }, gear),
});

describe('freeSwitchSlots', () => {
  test('counts supplies and the rune pouch', () => {
    expect(freeSwitchSlots({ brews: 6, restores: 5, reserved: 4 }, 'thralls')).toBe(12);
    expect(freeSwitchSlots({ brews: 6, restores: 5, reserved: 4 }, 'none')).toBe(13);
  });
});

describe('layoutLoadout', () => {
  test('places switches then supplies', () => {
    const main = setup({ head: 27235 });
    // worn: Twisted bow, dragon arrows, Masori mask; switches: Abyssal whip, Elder maul
    const layout = layoutLoadout([20997, 11212, 27235, 4151, 21003], main, { brews: 6, restores: 5, reserved: 4 }, 'ancients');
    expect(layout.worn).toMatchObject({ weapon: 20997, ammo: 11212, head: 27235 });
    expect(layout.inventory).toHaveLength(28);
    expect(layout.inventory.slice(0, 2)).toEqual([{ kind: 'item', itemId: 4151 }, { kind: 'item', itemId: 21003 }]);
    expect(layout.inventory[2]).toEqual({ kind: 'supply', label: 'Rune pouch' });
    expect(layout.inventory.slice(3, 7).every((c) => c?.kind === 'supply' && c.label === 'Reserved')).toBe(true);
    expect(layout.inventory.slice(7, 12).every((c) => c?.kind === 'supply' && c.label === 'Restore')).toBe(true);
    expect(layout.inventory.slice(12, 18).every((c) => c?.kind === 'supply' && c.label === 'Brew')).toBe(true);
    expect(layout.inventory.slice(18).every((c) => c === null)).toBe(true);
    expect(layout.overflow).toBe(0);
  });

  test('quiver holds a second ammo', () => {
    const main = setup({ cape: 28951 });
    const layout = layoutLoadout([20997, 11212, 28951, 21944], main, { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.worn.quiverAmmo).toBe(21944);
    expect(layout.inventory.every((c) => c === null)).toBe(true);
  });

  test('an empty ammo slot is filled with an ammo switch, and the quiver holds the next', () => {
    const scythe = availableEquipment.find((e) => e.id === 22325)!;
    const main: BulkSetup = {
      id: 'main',
      name: 'main',
      player: buildPlayer(generateEmptyPlayer(), {
        style: 'slash', weaponId: 22325, combatStyle: getCombatStylesForCategory(scythe.category).find((s) => s.type === 'slash')!, ammoId: null, spellName: null, dartId: null,
      }, {}),
    };
    // the quiver is a switch: it keeps its ammo when not worn
    const layout = layoutLoadout([22325, 20997, 11212, 21944, 28951], main, { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.worn.ammo).toBe(11212);
    expect(layout.worn.quiverAmmo).toBe(21944);
    expect(layout.inventory.filter((c) => c !== null)).toEqual([{ kind: 'item', itemId: 20997 }, { kind: 'item', itemId: 28951 }]);
  });

  test('without a quiver a second ammo goes in the inventory', () => {
    const layout = layoutLoadout([20997, 11212, 21944], setup({}), { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.worn.quiverAmmo).toBeUndefined();
    expect(layout.inventory[0]).toEqual({ kind: 'item', itemId: 21944 });
  });

  test('reports overflow', () => {
    const switches = availableEquipment.filter((e) => e.slot === 'hands').slice(0, 30).map((e) => e.id);
    const layout = layoutLoadout(switches, null, { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.overflow).toBe(2);
    expect(layout.inventory.filter((c) => c !== null)).toHaveLength(28);
  });

  test('supplies are kept and switches overflow', () => {
    const switches = availableEquipment.filter((e) => e.slot === 'hands').slice(0, 10).map((e) => e.id);
    const layout = layoutLoadout(switches, null, { brews: 10, restores: 10, reserved: 0 }, 'none');
    expect(layout.overflow).toBe(2);
    expect(layout.inventory.filter((c) => c?.kind === 'supply')).toHaveLength(20);
  });
});
