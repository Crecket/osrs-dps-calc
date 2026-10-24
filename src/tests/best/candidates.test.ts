import { describe, expect, test } from '@jest/globals';
import { AmmoApplicability, ammoApplicability, availableEquipment } from '@/lib/Equipment';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { EquipmentPiece } from '@/types/Player';
import { isEffectItem } from '@/best/lib/effectItems';
import {
  bestPool, paretoFront, slotCandidates, styleScore, weaponJobs,
} from '@/best/lib/candidates';
import { BEST_STYLES } from '@/best/types';
import { findEquipment } from '@/tests/utils/TestUtils';

const pool = bestPool();

const synthetic = (id: number, slash: number, str: number): EquipmentPiece => {
  const whip = findEquipment('Abyssal whip');
  return {
    ...whip,
    id,
    offensive: { ...whip.offensive, slash },
    bonuses: { ...whip.bonuses, str },
  };
};

describe('bestPool', () => {
  test('drops uncharged, inactive, Deadman, cosmetic and unobtainable items', () => {
    const versions = ['Uncharged', 'Inactive', 'Deadman Mode', 'Cosmetic', 'Broken'];
    expect(pool.filter((e) => versions.includes(e.version))).toEqual([]);
    expect(pool.filter((e) => /\(unobtainable item\)|\(beta\)/i.test(e.name))).toEqual([]);
    expect(pool.map((e) => e.id)).toContain(findEquipment('Scythe of Vitur', 'Charged').id);
  });
});

describe('styleScore', () => {
  test('melee uses the style attack bonus and str', () => {
    const torva = findEquipment('Torva full helm', 'Restored');
    expect(styleScore(torva, 'slash')).toEqual([torva.offensive.slash, torva.bonuses.str]);
  });

  test('ranged and magic use their own bonuses', () => {
    const tbow = findEquipment('Twisted bow');
    expect(styleScore(tbow, 'ranged')).toEqual([tbow.offensive.ranged, tbow.bonuses.ranged_str]);
    const shadow = findEquipment("Tumeken's shadow", 'Charged');
    expect(styleScore(shadow, 'magic')).toEqual([shadow.offensive.magic, shadow.bonuses.magic_str]);
  });
});

describe('paretoFront', () => {
  test('drops items another item matches or beats on both numbers', () => {
    const items = [synthetic(1, 5, 5), synthetic(2, 4, 4), synthetic(3, 6, 1)];
    expect(paretoFront(items, 'slash').map((e) => e.id)).toEqual([1, 3]);
  });

  test('ties keep the lowest id', () => {
    const items = [synthetic(9, 5, 5), synthetic(4, 5, 5)];
    expect(paretoFront(items, 'slash').map((e) => e.id)).toEqual([4]);
  });
});

describe('slotCandidates', () => {
  test('slash head: few plain items, slayer helm among effect items', () => {
    const { plain, effect } = slotCandidates(pool, 'slash', 'head');
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.length).toBeLessThanOrEqual(5);
    expect(plain.some(isEffectItem)).toBe(false);
    expect(plain.every((e) => e.slot === 'head')).toBe(true);
    expect(effect.some((e) => e.name === 'Slayer helmet (i)')).toBe(true);
  });
});

describe('weaponJobs', () => {
  test('slash: only slash styles, scythe with every slash stance, no magic-only weapons', () => {
    const jobs = weaponJobs(pool, 'slash');
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => j.combatStyle.type === 'slash')).toBe(true);
    expect(jobs.every((j) => j.style === 'slash' && j.ammoId === null && j.spellName === null && j.dartId === null)).toBe(true);

    const scythe = findEquipment('Scythe of Vitur', 'Charged');
    expect(jobs.filter((j) => j.weaponId === scythe.id).map((j) => j.combatStyle.stance).sort())
      .toEqual(['Accurate', 'Aggressive']);

    const shadow = findEquipment("Tumeken's shadow", 'Charged');
    expect(jobs.some((j) => j.weaponId === shadow.id)).toBe(false);
  });

  test('ranged: ammo is valid, blowpipes take darts, bofa takes no ammo', () => {
    const jobs = weaponJobs(pool, 'ranged');
    expect(jobs.every((j) => j.combatStyle.type === 'ranged')).toBe(true);
    jobs.forEach((j) => {
      if (ammoApplicability(j.weaponId, undefined) !== AmmoApplicability.ALLOWED) {
        expect(ammoApplicability(j.weaponId, j.ammoId ?? undefined)).toBe(AmmoApplicability.INCLUDED);
      } else {
        expect(j.ammoId).toBeNull();
      }
      if (j.dartId !== null) expect(BLOWPIPE_IDS).toContain(j.weaponId);
    });

    const tbow = findEquipment('Twisted bow');
    expect(jobs.some((j) => j.weaponId === tbow.id && j.ammoId !== null)).toBe(true);

    const bp = findEquipment('Toxic blowpipe', 'Charged');
    const bpJobs = jobs.filter((j) => j.weaponId === bp.id);
    expect(bpJobs.length).toBeGreaterThan(0);
    expect(bpJobs.every((j) => j.ammoId === null && j.dartId !== null)).toBe(true);

    const bofa = findEquipment('Bow of Faerdhinen', 'Charged');
    const bofaJobs = jobs.filter((j) => j.weaponId === bofa.id);
    expect(bofaJobs.length).toBeGreaterThan(0);
    expect(bofaJobs.every((j) => j.ammoId === null && j.dartId === null)).toBe(true);
  });

  test('magic: powered staves cast no spell, spellcasting staves get the spell list', () => {
    const jobs = weaponJobs(pool, 'magic');
    expect(jobs.every((j) => j.combatStyle.type === 'magic')).toBe(true);
    expect(jobs.some((j) => j.combatStyle.stance === 'Defensive Autocast' || j.combatStyle.stance === 'Longrange')).toBe(false);

    const shadow = findEquipment("Tumeken's shadow", 'Charged');
    const shadowJobs = jobs.filter((j) => j.weaponId === shadow.id);
    expect(shadowJobs.length).toBeGreaterThan(0);
    expect(shadowJobs.every((j) => j.spellName === null)).toBe(true);

    const kodai = findEquipment('Kodai wand');
    const staffSpells = jobs.filter((j) => j.weaponId === kodai.id).map((j) => j.spellName);
    expect(staffSpells).toEqual(expect.arrayContaining([
      'Wind Surge', 'Water Surge', 'Earth Surge', 'Fire Surge',
      'Blood Barrage', 'Ice Barrage', 'Shadow Barrage', 'Smoke Barrage',
      'Saradomin Strike', 'Claws of Guthix', 'Flames of Zamorak', 'Iban Blast', 'Magic Dart', 'Crumble Undead',
      'Inferior Demonbane', 'Superior Demonbane', 'Dark Demonbane',
      'Ghostly Grasp', 'Skeletal Grasp', 'Undead Grasp',
    ]));
    ['Fire Wave', 'Fire Bolt', 'Ice Blitz', 'Bind', 'Entangle', 'Confuse', 'Tele Block'].forEach((s) => expect(staffSpells).not.toContain(s));

    // the Twinflame staff adds a hitsplat to Bolt, Blast and Wave spells
    const twinflame = findEquipment('Twinflame staff');
    const twinSpells = jobs.filter((j) => j.weaponId === twinflame.id).map((j) => j.spellName);
    expect(twinSpells).toEqual(expect.arrayContaining([...staffSpells, 'Fire Wave', 'Fire Blast', 'Fire Bolt', 'Wind Wave', 'Water Bolt', 'Earth Blast']));
    expect(twinSpells).not.toContain('Fire Strike');

    // every other spellcasting weapon gets the same list; plain staves like the Staff of fire lose to better plain staves
    const withSpells = jobs.filter((j) => j.spellName !== null && j.weaponId !== twinflame.id);
    new Set(withSpells.map((j) => j.weaponId)).forEach((id) => {
      expect(new Set(withSpells.filter((j) => j.weaponId === id).map((j) => j.spellName))).toEqual(new Set(staffSpells));
    });
    expect(jobs.some((j) => j.weaponId === findEquipment('Staff of fire').id)).toBe(false);
  });

  test('no stance without offence', () => {
    BEST_STYLES.forEach((style) => {
      const stances = new Set(weaponJobs(pool, style).map((j) => j.combatStyle.stance));
      if (style === 'ranged' || style === 'magic') {
        expect([style, stances.has('Longrange') || stances.has('Defensive Autocast')]).toEqual([style, false]);
      } else {
        expect([style, stances.has('Defensive')]).toEqual([style, false]);
      }
    });
  });

  test('category effect weapons are pruned like plain ones', () => {
    const jobs = weaponJobs(pool, 'ranged');
    // same ammo list (bronze tier); the bronze crossbow has more accuracy, crossbow bolt procs are the same
    expect(jobs.some((j) => j.weaponId === findEquipment('Crossbow').id)).toBe(false);
    expect(jobs.some((j) => j.weaponId === findEquipment('Bronze crossbow').id)).toBe(true);
    // named effect weapons are always kept
    expect(jobs.some((j) => j.weaponId === findEquipment('Dragon crossbow').id)).toBe(true);
  });

  test('plain ammo is pruned per kind, named ammo is kept', () => {
    const jobs = weaponJobs(pool, 'ranged');
    const ammoNames = (weapon: string) => new Set(jobs.filter((j) => j.weaponId === findEquipment(weapon).id)
      .map((j) => pool.find((e) => e.id === j.ammoId)?.name));
    const tbow = ammoNames('Twisted bow');
    expect(tbow.has('Dragon arrow')).toBe(true);
    expect(tbow.has('Rune arrow')).toBe(false);
    const acb = ammoNames('Armadyl crossbow');
    expect(acb.has('Ruby dragon bolts (e)')).toBe(true);
    expect(acb.has('Diamond dragon bolts (e)')).toBe(true);
    expect(acb.has('Runite bolts')).toBe(false);
    // the engine checks silver bolts by name (vampyres)
    expect(ammoNames('Rune crossbow').has('Silver bolts')).toBe(true);
  });

  test('magic jobs only for weapons that autocast, have built-in magic or magic strength', () => {
    const ids = new Set(weaponJobs(pool, 'magic').map((j) => j.weaponId));
    ['Dragon dagger', 'Keris', 'Abyssal dagger'].forEach((name) => {
      expect([name, availableEquipment.some((e) => e.name === name && ids.has(e.id))]).toEqual([name, false]);
    });
    // the Rod of Ivandis is a Staff (it can autocast); its ten charge versions collapse to one
    expect(availableEquipment.filter((e) => e.name === 'Rod of Ivandis' && ids.has(e.id))).toHaveLength(1);
    expect(ids.has(findEquipment('Kodai wand').id)).toBe(true);
    expect(ids.has(findEquipment("Tumeken's shadow", 'Charged').id)).toBe(true);
  });

  test('variants with equal stats collapse to the lowest id', () => {
    const ids = new Set(weaponJobs(pool, 'stab').map((j) => j.weaponId));
    const daggers = availableEquipment.filter((e) => e.name === 'Dragon dagger' && ids.has(e.id));
    expect(daggers.map((e) => e.id)).toEqual([Math.min(...pool.filter((e) => e.name === 'Dragon dagger').map((e) => e.id))]);
  });

  test('jobs carry no shield and are deterministic', () => {
    const jobs = weaponJobs(pool, 'crush');
    jobs.forEach((j) => expect(Object.keys(j).sort())
      .toEqual(['ammoId', 'combatStyle', 'dartId', 'spellName', 'style', 'weaponId']));
    expect(weaponJobs([...pool].reverse(), 'crush')).toEqual(jobs);
  });
});
