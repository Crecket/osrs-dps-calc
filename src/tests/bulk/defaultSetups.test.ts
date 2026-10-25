import { describe, expect, test } from '@jest/globals';
import { DEFAULT_SETUP_NAMES, defaultSetups } from '@/bulk/lib/defaultSetups';
import { computeRow } from '@/bulk/lib/compute';
import { monsterFromSearch } from '@/bulk/lib/presetIO';
import { getMonsters } from '@/lib/Monsters';
import { Prayer } from '@/enums/Prayer';
import { setupKey } from '@/bulk/lib/dedupe';

const byName = (name: string) => defaultSetups().setups.find((s) => s.name === name)!.player;

describe('defaultSetups', () => {
  test('default setups load in order with no warnings', () => {
    const { setups, warnings } = defaultSetups();
    expect(setups.map((s) => s.name)).toEqual(DEFAULT_SETUP_NAMES);
    expect(warnings).toEqual([]);
  });

  test('each default setup has its weapon, prayer, style and boost', () => {
    const scythe = byName('Max scythe');
    expect(scythe.equipment.weapon?.id).toBe(22325);
    expect(scythe.equipment.shield).toBeNull();
    expect(scythe.prayers).toContain(Prayer.PIETY);
    expect(scythe.style.name).toBe('Chop');
    expect(scythe.boosts.str).toBeGreaterThan(0);

    const inq = byName('Max scythe inquisitor');
    expect(inq.equipment.head?.id).toBe(24419);
    expect(inq.style.name).toBe('Jab');

    const range = byName('Max range');
    expect(range.equipment.weapon?.id).toBe(20997);
    expect(range.style.name).toBe('Rapid');
    expect(range.prayers).toContain(Prayer.RIGOUR);
    expect(range.boosts.ranged).toBeGreaterThan(0);

    const bp = byName('Max range blowpipe');
    expect(bp.equipment.weapon?.id).toBe(12926);
    expect(bp.equipment.weapon?.itemVars?.blowpipeDartId).toBe(11230);

    const voidBp = byName('Max range void blowpipe');
    expect(voidBp.equipment.weapon?.id).toBe(12926);
    expect(voidBp.equipment.weapon?.itemVars?.blowpipeDartId).toBe(11230);
    expect(voidBp.equipment.body?.id).toBe(13072);

    const ayak = byName('Max ayak');
    expect(ayak.equipment.shield?.id).toBe(27251);
    expect(ayak.prayers).toContain(Prayer.AUGURY);
    expect(ayak.boosts.magic).toBeGreaterThan(0);

    for (const element of ['Wind', 'Water', 'Earth', 'Fire']) {
      const harm = byName(`Max harm ${element.toLowerCase()} surge`);
      expect(harm.equipment.weapon?.id).toBe(24423);
      expect(harm.equipment.shield?.id).toBe(27251);
      expect(harm.spell?.name).toBe(`${element} Surge`);
      expect(harm.style.type).toBe('magic');
    }
  });

  test('armour variants and weapon buffs', () => {
    expect(byName('Max scythe oathplate').equipment.body?.id).toBe(30753);
    const mixed = byName('Max scythe torva/oathplate');
    expect([mixed.equipment.head?.id, mixed.equipment.body?.id, mixed.equipment.legs?.id]).toEqual([26382, 30753, 30756]);

    const reaper = byName('Max soulreaper inquisitor');
    expect(reaper.equipment.shield).toBeNull();
    expect(reaper.style.name).toBe('Smash');
    expect(reaper.style.type).toBe('crush');
    expect(reaper.buffs.soulreaperStacks).toBe(5);

    const mace = byName("Max inquisitor's mace");
    expect(mace.equipment.shield?.id).toBe(22322);
    expect(mace.equipment.head?.id).toBe(24419);
    expect(mace.style.name).toBe('Pummel');

    const bellator = byName('Max scythe oathplate bellator');
    expect(bellator.equipment.ring?.id).toBe(28316);
    expect(bellator.equipment.body?.id).toBe(30753);
    expect(byName('Max lance swipe oathplate bellator').equipment.ring?.id).toBe(28316);
    const names = defaultSetups().setups.map((s) => s.name);
    expect(names).not.toContain('Max scythe inquisitor bellator');
    expect(names).not.toContain('Max fang bellator');
    for (const weapon of ['scythe', 'soulreaper', 'lance swipe', 'blade of saeldor', 'noxious halberd', 'tentacle', 'voidwaker', 'emberlight']) {
      for (const armour of ['', ' oathplate', ' torva/oathplate']) {
        expect(names).toContain(`Max ${weapon}${armour}`);
        expect(names).toContain(`Max ${weapon}${armour} bellator`);
      }
    }

    const bloodMoon = byName('Max macuahuitl blood moon');
    expect([bloodMoon.equipment.head?.name, bloodMoon.equipment.body?.name, bloodMoon.equipment.legs?.name])
      .toEqual(['Blood Moon helm', 'Blood Moon chestplate', 'Blood Moon tassets']);

    // no blood fury or salve(ei) neck variants
    expect(names.filter((n) => n.endsWith(' blood fury') || n.endsWith(' salve(ei)'))).toEqual([]);
    expect(names).toHaveLength(74);
    for (const kept of ['Max scythe torva/oathplate bellator', 'Max ayak', 'Max harm fire surge', 'Max range void blowpipe']) {
      expect(names).toContain(kept);
    }

    const lance = byName('Max lance swipe oathplate');
    expect(lance.style.type).toBe('slash');
    expect(lance.equipment.head?.id).toBe(30750);

    const masoriBowfa = byName('Max bowfa');
    expect(masoriBowfa.equipment.body?.id).toBe(27238);
    expect(masoriBowfa.equipment.ammo).toBeNull();

    const bowfa = byName('Max bowfa crystal');
    expect(bowfa.equipment.body?.id).toBe(23975);
    expect(bowfa.equipment.ammo).toBeNull();
    expect(byName('Max zcb ruby').equipment.ammo?.id).toBe(21944);
  });

  test('no two default setups are the same', () => {
    const { setups } = defaultSetups();
    expect(new Set(setups.map((s) => setupKey(s.player))).size).toBe(setups.length);
  });

  test('every default setup damages a standard monster', () => {
    const abyssal = monsterFromSearch(getMonsters().find((m) => m.id === 415)!);
    for (const setup of defaultSetups().setups) {
      const row = computeRow(setup, abyssal);
      expect([setup.name, row.error]).toEqual([setup.name, undefined]);
      expect([setup.name, row.dps > 0]).toEqual([setup.name, true]);
    }
  });

  test("the surge matching a monster's elemental weakness hits hardest", () => {
    // all elements of a tier share a max hit (upstream's getSpellMaxHit); only weaknesses tell them apart
    const vorkath = monsterFromSearch(getMonsters().find((m) => m.name === 'Vorkath' && m.weakness?.element === 'fire')!);
    const maxHit = (e: string) => computeRow(defaultSetups().setups.find((s) => s.name === `Max harm ${e} surge`)!, vorkath).maxHit;

    expect(maxHit('fire')).toBeGreaterThan(maxHit('water'));
    expect(maxHit('water')).toBe(maxHit('wind'));
  });

  test('ids are fresh on every call', () => {
    expect(defaultSetups().setups[0].id).not.toBe(defaultSetups().setups[0].id);
  });
});
