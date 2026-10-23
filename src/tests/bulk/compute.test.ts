import { describe, expect, test } from '@jest/globals';
import { computeRow, prepareMonster } from '@/bulk/lib/compute';
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
});
