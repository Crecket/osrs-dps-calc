import { describe, expect, test } from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { generateEmptyPlayer } from '@/state';
import { buildPlayer } from '@/best/lib/search';
import { BulkSetup } from '@/bulk/types';
import { freeSwitchSlots, layoutLoadout, slotEfficientLayout } from '@/raid/lib/layout';

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
  test('places switches, then empty cells, then supplies with the rune pouch in the bottom right', () => {
    const main = setup({ head: 27235 });
    // worn: Twisted bow, dragon arrows, Masori mask; switches: Abyssal whip, Elder maul
    const layout = layoutLoadout([20997, 11212, 27235, 4151, 21003], main, { brews: 6, restores: 5, reserved: 4 }, 'ancients');
    expect(layout.worn).toMatchObject({ weapon: 20997, ammo: 11212, head: 27235 });
    expect(layout.inventory).toHaveLength(28);
    expect(layout.inventory.slice(0, 2)).toEqual([{ kind: 'item', itemId: 4151 }, { kind: 'item', itemId: 21003 }]);
    expect(layout.inventory.slice(2, 12).every((c) => c === null)).toBe(true);
    expect(layout.inventory.slice(12, 16).every((c) => c?.kind === 'supply' && c.label === 'Reserved')).toBe(true);
    expect(layout.inventory.slice(16, 21).every((c) => c?.kind === 'supply' && c.label === 'Restore')).toBe(true);
    expect(layout.inventory.slice(21, 27).every((c) => c?.kind === 'supply' && c.label === 'Brew')).toBe(true);
    expect(layout.inventory[27]).toEqual({ kind: 'supply', label: 'Rune pouch' });
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
    // the quiver fills the empty cape slot
    const layout = layoutLoadout([22325, 20997, 11212, 21944, 28951], main, { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.worn).toMatchObject({ ammo: 11212, quiverAmmo: 21944, cape: 28951 });
    expect(layout.inventory.filter((c) => c !== null)).toEqual([{ kind: 'item', itemId: 20997 }]);
  });

  test('a quiver switch keeps its ammo too', () => {
    // the cape slot is taken, so the quiver is a switch
    const layout = layoutLoadout([20997, 11212, 22109, 21944, 28951], setup({ cape: 22109 }), { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.worn.quiverAmmo).toBe(21944);
    expect(layout.inventory.filter((c) => c !== null)).toEqual([{ kind: 'item', itemId: 28951 }]);
  });

  test('an empty worn slot holds a switch instead of the inventory: the Book of the Dead next to a one-handed weapon', () => {
    const whip = availableEquipment.find((e) => e.id === 4151)!;
    const main: BulkSetup = {
      id: 'main',
      name: 'main',
      player: buildPlayer(generateEmptyPlayer(), {
        style: 'slash', weaponId: 4151, combatStyle: getCombatStylesForCategory(whip.category).find((s) => s.type === 'slash')!, ammoId: null, spellName: null, dartId: null,
      }, { head: 27235 }),
    };
    const layout = layoutLoadout([4151, 27235, 25818, 19547, 26382], main, { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.worn).toMatchObject({ shield: 25818, neck: 19547 });
    // the head slot is taken, so the other helm stays a switch
    expect(layout.inventory.filter((c) => c !== null)).toEqual([{ kind: 'item', itemId: 26382 }]);
  });

  test('a two-handed weapon leaves the shield slot empty', () => {
    const layout = layoutLoadout([20997, 11212, 25818], setup({}), { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.worn.shield).toBeUndefined();
    expect(layout.inventory[0]).toEqual({ kind: 'item', itemId: 25818 });
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

describe('slotEfficientLayout', () => {
  test('wears the setup that leaves the fewest switches: a one-handed weapon with the book beside it over a two-handed bow', () => {
    const whip = availableEquipment.find((e) => e.id === 4151)!;
    const melee: BulkSetup = {
      id: 'melee',
      name: 'melee',
      player: buildPlayer(generateEmptyPlayer(), {
        style: 'slash', weaponId: 4151, combatStyle: getCombatStylesForCategory(whip.category).find((s) => s.type === 'slash')!, ammoId: null, spellName: null, dartId: null,
      }, {}),
    };
    const items = [20997, 11212, 4151, 25818];
    const none = { brews: 0, restores: 0, reserved: 0 };
    // the bow first, as the setup used the longest: whip and book would be switches
    expect(layoutLoadout(items, setup({}), none, 'none').inventory.filter((c) => c !== null)).toHaveLength(2);
    const layout = slotEfficientLayout(items, [setup({}), melee], none, 'none');
    expect(layout.worn).toMatchObject({ weapon: 4151, shield: 25818, ammo: 11212 });
    expect(layout.inventory.filter((c) => c !== null)).toEqual([{ kind: 'item', itemId: 20997 }]);
  });

  test('of equally good setups the first one stays worn', () => {
    const layout = slotEfficientLayout([20997, 11212], [setup({}), setup({})], { brews: 0, restores: 0, reserved: 0 }, 'none');
    expect(layout.worn.weapon).toBe(20997);
  });
});
