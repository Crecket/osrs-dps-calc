import { describe, expect, test } from '@jest/globals';
import { computeRow, preparePlayer, scaledMonster } from '@/bulk/lib/compute';
import { prepareMonster } from '@/bulk/lib/prepareMonster';
import { BulkMonster, BulkSetup } from '@/bulk/types';
import { Monster } from '@/types/Monster';
import { Player } from '@/types/Player';
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { getMonsters } from '@/lib/Monsters';
import {
  calculatePlayerVsNpc, findEquipment, findSpell, getTestMonster, getTestPlayer,
} from '@/tests/utils/TestUtils';

const setup = (player: Player): BulkSetup => ({ id: 's1', name: 'Setup', player });
const entry = (monster: Monster): BulkMonster => ({ id: 'm1', monster });

describe('computeRow', () => {
  test('matches PlayerVsNPCCalc for a melee setup', () => {
    const monster = getTestMonster('Abyssal demon', 'Standard');
    const player = getTestPlayer(monster, { equipment: { weapon: findEquipment('Abyssal whip') } });

    const row = computeRow(setup(player), entry(monster));
    const expected = calculatePlayerVsNpc(monster, player);

    expect(row.dps).toBeCloseTo(expected.dps, 10);
    expect(row.maxHit).toBe(expected.maxHit);
    expect(row.setupId).toBe('s1');
    expect(row.monsterId).toBe('m1');
  });

  test('matches for ranged and magic setups', () => {
    const monster = getTestMonster('Abyssal demon', 'Standard');
    const ranged = getTestPlayer(monster, {
      equipment: { weapon: findEquipment('Twisted bow'), ammo: findEquipment('Dragon arrow', 'Unpoisoned') },
    });
    const magic = getTestPlayer(monster, {
      equipment: { weapon: findEquipment('Kodai wand') },
      spell: findSpell('Fire Surge'),
    });

    for (const player of [ranged, magic]) {
      const row = computeRow(setup(player), entry(monster));
      const expected = calculatePlayerVsNpc(monster, player);
      expect(row.dps).toBeGreaterThan(0);
      expect(row.dps).toBeCloseTo(expected.dps, 10);
      expect(row.maxHit).toBe(expected.maxHit);
    }
  });

  test('recomputes bonuses per monster', () => {
    const demon = getTestMonster('Abyssal demon', 'Standard');
    const akkha = getTestMonster('Akkha', '', { inputs: { toaInvocationLevel: 300 } });
    const overrides = { equipment: { weapon: findEquipment("Tumeken's shadow", 'Charged') } };

    const preparedForDemon = getTestPlayer(demon, overrides);
    const preparedForAkkha = getTestPlayer(akkha, overrides);

    const row = computeRow(setup(preparedForDemon), entry(akkha));
    const expected = calculatePlayerVsNpc(akkha, preparedForAkkha);

    // guard: the stale (demon-prepared) player must give a different answer, or this test proves nothing
    expect(calculatePlayerVsNpc(akkha, preparedForDemon).dps).not.toBeCloseTo(expected.dps, 5);
    expect(row.dps).toBeCloseTo(expected.dps, 10);
    expect(row.maxHit).toBe(expected.maxHit);
  });

  test('spec is null for a weapon without a supported spec', () => {
    const monster = getTestMonster('Abyssal demon', 'Standard');
    const player = getTestPlayer(monster, { equipment: { weapon: findEquipment('Scythe of Vitur', 'Charged') } });

    expect(computeRow(setup(player), entry(monster)).spec).toBeNull();
  });

  test('spec metrics for a supported spec', () => {
    const monster = getTestMonster('Abyssal demon', 'Standard');
    const player = getTestPlayer(monster, { equipment: { weapon: findEquipment('Dragon claws') } });

    const row = computeRow(setup(player), entry(monster));
    const specCalc = new PlayerVsNPCCalc(player, monster, { loadoutName: 't' }).getSpecCalc()!;

    expect(row.spec).not.toBeNull();
    expect(row.spec!.expected).toBeGreaterThan(0);
    expect(row.spec!.expected).toBeCloseTo(specCalc.getExpectedDamage(), 10);
    expect(row.spec!.maxHit).toBe(specCalc.getMax());
    expect(row.spec!.partial).toBe(false);
  });

  test('spec DPS is per attack, like the calculator\'s spec DPS; spec-only DPS accounts for energy regen', () => {
    const monster = getTestMonster('Abyssal demon', 'Standard');
    const player = getTestPlayer(monster, {
      equipment: { weapon: findEquipment('Zaryte crossbow'), ammo: findEquipment('Ruby dragon bolts (e)') },
    });

    const row = computeRow(setup(player), entry(monster));
    const specCalc = new PlayerVsNPCCalc(player, monster, { loadoutName: 't' }).getSpecCalc()!;

    expect(row.spec!.dps).toBeCloseTo(specCalc.getDps(), 10);
    expect(row.spec!.regenDps).toBeCloseTo(specCalc.getSpecDps(), 10);
    expect(row.spec!.dps).toBeGreaterThan(row.spec!.regenDps * 10);
  });

  test('a setup that cannot damage the monster has no ttk', () => {
    const monster = getTestMonster('Zulrah', 'Serpentine');
    const player = getTestPlayer(monster, { equipment: { weapon: findEquipment('Abyssal whip') } });

    const row = computeRow(setup(player), entry(monster));

    expect(row.maxHit).toBe(0);
    expect(row.ttk).toBeNull();
  });

  test('errors become rows, not throws', () => {
    const monster = getTestMonster('Abyssal demon', 'Standard');
    const player = getTestPlayer(monster, { equipment: { weapon: findEquipment('Abyssal whip') } });
    const broken = { ...monster, skills: undefined } as unknown as Monster;

    const row = computeRow(setup(player), entry(broken));

    expect(typeof row.error).toBe('string');
    expect(row.error!.length).toBeGreaterThan(0);
    expect(row.dps).toBe(0);
    expect(row.spec).toBeNull();
  });
});

describe('prepareMonster', () => {
  const base = (id: number) => getMonsters().find((m) => m.id === id)!;

  test('defaults the phase for phased monsters', () => {
    expect(prepareMonster(base(13599)).inputs.phase).toBe('Shielded');
  });

  test('defaults current hp to the scaled hp', () => {
    // INITIAL_MONSTER_INPUTS.monsterCurrentHp is 150, so use monsters whose hp differs from it
    const graardor = getMonsters().find((m) => m.name === 'General Graardor')!;
    expect(prepareMonster(graardor).inputs.monsterCurrentHp).toBe(graardor.skills.hp);

    const akkha = getMonsters().find((m) => m.name === 'Akkha')!;
    expect(prepareMonster(akkha, { toaInvocationLevel: 300 }).inputs.monsterCurrentHp).toBeGreaterThan(akkha.skills.hp);
  });

  test('keeps explicit inputs', () => {
    const m = prepareMonster(base(13599), { phase: 'Unshielded', defenceReductions: { dwh: 2 } });
    expect(m.inputs.phase).toBe('Unshielded');
    expect(m.inputs.defenceReductions.dwh).toBe(2);
    expect(m.inputs.defenceReductions.bgs).toBe(0);
  });

  test('a DPS-only row scales a monster once, leaves it unchanged, and matches the full row on its own inputs', () => {
    const monster = getTestMonster('Akkha', '', { inputs: { partySize: 8, toaInvocationLevel: 300, defenceReductions: { dwh: 2 } } });
    const before = JSON.stringify(monster);
    const player = getTestPlayer(monster, { equipment: { weapon: findEquipment('Abyssal whip') } });
    const { dps } = computeRow(setup(player), entry(monster));

    expect(dps).toBeGreaterThan(0);
    expect(computeRow(setup(player), entry(monster), 'dps').dps).toBe(dps);
    expect(computeRow(setup(player), entry(monster), 'dps').dps).toBe(dps);
    expect(JSON.stringify(monster)).toBe(before);
    // a new monster object with other inputs doesn't get the old scaling
    const reduced = { ...monster, inputs: { ...monster.inputs, defenceReductions: { ...monster.inputs.defenceReductions, dwh: 0 } } };
    expect(computeRow(setup(player), entry(reduced), 'dps').dps).toBe(computeRow(setup(player), entry(reduced)).dps);
    expect(computeRow(setup(player), entry(reduced), 'dps').dps).not.toBe(dps);
  });

  test('a DPS-only row of a custom monster (id -1) isn\'t scaled, like the full row', () => {
    const monster = { ...getTestMonster('Vorkath', 'Post-quest'), id: -1 };
    const player = getTestPlayer(monster, { equipment: { weapon: findEquipment('Abyssal whip') } });
    expect(computeRow(setup(player), entry(monster), 'dps').dps).toBe(computeRow(setup(player), entry(monster)).dps);
  });

  test('specs start from the unscaled monster: the Tonalztics spec scales it again for its second hit', () => {
    const monster = prepareMonster(getTestMonster('Great Olm', 'Head (Normal)'), { partySize: 8 });
    const player = getTestPlayer(monster, {
      equipment: { weapon: findEquipment('Tonalztics of Ralos', 'Charged') },
      style: { name: 'Rapid', type: 'ranged', stance: 'Rapid' },
    });
    const prepared = preparePlayer(player, monster);
    const expected = new PlayerVsNPCCalc(prepared, monster, { loadoutName: 's1' }).getSpecCalc()!.getExpectedDamage();
    const doubled = new PlayerVsNPCCalc(prepared, scaledMonster(monster), { loadoutName: 's1', disableMonsterScaling: true }).getSpecCalc()!.getExpectedDamage();

    expect(doubled).not.toBe(expected);
    expect(computeRow(setup(player), entry(monster)).spec?.expected).toBe(expected);
    expect(computeRow(setup(player), entry(monster), 'spec').spec?.expected).toBe(expected);
  });

  test('a partial row has the same numbers as the full row, and nothing else', () => {
    const monster = getTestMonster('Vorkath', 'Post-quest');
    const players = [
      getTestPlayer(monster, { equipment: { weapon: findEquipment('Abyssal whip') } }),
      getTestPlayer(monster, { equipment: { weapon: findEquipment('Dragon claws') } }),
      getTestPlayer(monster, { equipment: { weapon: findEquipment('Toxic blowpipe') } }),
    ];
    players.forEach((player) => {
      const full = computeRow(setup(player), entry(monster));
      const dps = computeRow(setup(player), entry(monster), 'dps');
      const spec = computeRow(setup(player), entry(monster), 'spec');
      expect(dps.dps).toBe(full.dps);
      expect(dps.ttk).toBeNull();
      expect(dps.spec).toBeNull();
      expect(spec.spec).toEqual(full.spec);
      expect(spec.ttk).toBeNull();
    });
  });
});
