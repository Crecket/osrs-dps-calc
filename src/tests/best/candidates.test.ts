import { describe, expect, test } from '@jest/globals';
import {
  AmmoApplicability, ammoApplicability, availableEquipment, getCanonicalItemId,
} from '@/lib/Equipment';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { EquipmentPiece } from '@/types/Player';
import { isEffectItem } from '@/best/lib/effectItems';
import {
  paretoFront, slotCandidates, styleScore, weaponJobs,
} from '@/best/lib/candidates';
import { findEquipment } from '@/tests/utils/TestUtils';

const pool = availableEquipment.filter((e) => getCanonicalItemId(e.id) === e.id);

const synthetic = (id: number, slash: number, str: number): EquipmentPiece => {
  const whip = findEquipment('Abyssal whip');
  return {
    ...whip,
    id,
    offensive: { ...whip.offensive, slash },
    bonuses: { ...whip.bonuses, str },
  };
};

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
      .toEqual(['Accurate', 'Aggressive', 'Defensive']);

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
    expect(jobs.some((j) => j.combatStyle.stance === 'Defensive Autocast')).toBe(false);

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
    ['Fire Wave', 'Ice Blitz', 'Bind', 'Entangle', 'Confuse', 'Tele Block'].forEach((s) => expect(staffSpells).not.toContain(s));

    // every spellcasting weapon gets the same list; plain staves like the Staff of fire lose to better plain staves
    const withSpells = jobs.filter((j) => j.spellName !== null);
    new Set(withSpells.map((j) => j.weaponId)).forEach((id) => {
      expect(new Set(withSpells.filter((j) => j.weaponId === id).map((j) => j.spellName))).toEqual(new Set(staffSpells));
    });
    expect(jobs.some((j) => j.weaponId === findEquipment('Staff of fire').id)).toBe(false);
  });

  test('jobs carry no shield and are deterministic', () => {
    const jobs = weaponJobs(pool, 'crush');
    jobs.forEach((j) => expect(Object.keys(j).sort())
      .toEqual(['ammoId', 'combatStyle', 'dartId', 'spellName', 'style', 'weaponId']));
    expect(weaponJobs([...pool].reverse(), 'crush')).toEqual(jobs);
  });
});
