import {
  beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import {
  importShortlink, loadPreset, migrateImportable, presetFromJson, presetToJson,
} from '@/bulk/lib/presetIO';
import { BulkPreset } from '@/bulk/types';
import { IMPORT_VERSION, ImportableData } from '@/types/State';
import { CUSTOM_MONSTER_BASE } from '@/lib/Monsters';
import fixture from './fixtures/preset-v10.json';

const fixturePreset = (): BulkPreset => JSON.parse(JSON.stringify(fixture.preset));

describe('loadPreset', () => {
  test('fixture preset loads', () => {
    const { preset, warnings } = loadPreset(fixturePreset());

    expect(warnings).toEqual([]);
    expect(preset.serializationVersion).toBe(IMPORT_VERSION);
    expect(preset.setups.map((s) => s.id)).toEqual(['setup-whip', 'setup-claws']);
    expect(preset.setups[0].player.equipment.weapon?.name).toBe('Abyssal whip');
    expect(preset.setups[0].player.equipment.shield?.name).toBe('Dragon defender');
    expect(preset.setups[0].player.skills.atk).toBe(99);
    expect(preset.setups[1].name).toBe('Claws');
    expect(preset.monsters.map((m) => m.id)).toEqual(['monster-abyssal', 'monster-td']);
    expect(preset.monsters[1].monster.inputs.phase).toBe('Unshielded');
    expect(preset.monsters[1].monster.inputs.defenceReductions.dwh).toBe(1);
    expect(preset.monsters[1].monster.skills.hp).toBeGreaterThan(0);
  });

  test('missing item is dropped with a warning', () => {
    const raw = fixturePreset();
    raw.setups[0].player.equipment.shield = { id: 99999999 } as never;

    const { preset, warnings } = loadPreset(raw);

    expect(preset.setups[0].player.equipment.shield).toBeNull();
    expect(preset.setups[0].player.equipment.weapon?.name).toBe('Abyssal whip');
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Whip + defender');
    expect(warnings[0]).toContain('99999999');
  });

  test('missing item warning uses the setup name and the saved item name', () => {
    const raw = fixturePreset();
    raw.setups[0].name = 'Max melee';
    raw.setups[0].player.name = 'Loadout 1';
    raw.setups[0].player.equipment.head = { id: 99999998, name: 'Torva full helm' } as never;

    const { warnings } = loadPreset(raw);

    expect(warnings).toEqual(['Max melee: Torva full helm (head) no longer exists and was removed']);
  });

  test('a shield saved with a two-handed weapon is not reported as removed', () => {
    const raw = fixturePreset();
    raw.setups[1].player.equipment.shield = raw.setups[0].player.equipment.shield;

    const { preset, warnings } = loadPreset(raw);

    expect(preset.setups[1].player.equipment.weapon?.isTwoHanded).toBe(true);
    expect(warnings).toEqual([]);
  });

  test('a setup that fails to migrate is not blamed on the monster', () => {
    const raw = fixturePreset();
    raw.setups[0].player = null as never;

    const { warnings } = loadPreset(raw);

    expect(warnings.some((w) => w.includes('no longer exists'))).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  test('custom monster is kept as-is', () => {
    const raw = fixturePreset();
    const custom = {
      ...CUSTOM_MONSTER_BASE,
      name: 'My dummy',
      defensive: { ...CUSTOM_MONSTER_BASE.defensive, slash: 321 },
    };
    raw.monsters = [{ id: 'custom', monster: custom }];

    const { preset } = loadPreset(raw);

    expect(preset.monsters[0].monster.id).toBe(-1);
    expect(preset.monsters[0].monster.name).toBe('My dummy');
    expect(preset.monsters[0].monster.defensive.slash).toBe(321);
  });

  test('old serialization versions migrate', () => {
    const raw = fixturePreset();
    raw.serializationVersion = 6;
    (raw.monsters[0].monster.inputs as unknown as Record<string, number>).partyAvgMiningLevel = 90;
    raw.monsters[0].monster.inputs.partySize = 2;

    const { preset } = loadPreset(raw);

    expect(preset.monsters[0].monster.inputs.partySumMiningLevel).toBe(180);
  });
});

describe('migrateImportable', () => {
  test('returns only as many setups as were imported', () => {
    const data = {
      serializationVersion: IMPORT_VERSION,
      loadouts: [],
      selectedLoadout: 0,
      monster: fixturePreset().monsters[0].monster,
    } as unknown as ImportableData;

    expect(migrateImportable(data).setups).toEqual([]);
  });
});

describe('json', () => {
  test('json round-trip', () => {
    const { preset } = loadPreset(fixturePreset());
    const back = presetFromJson(presetToJson(preset));

    expect(back.id).not.toBe(preset.id);
    expect(back.name).toBe(preset.name);
    expect(back.setups.map((s) => s.player)).toEqual(preset.setups.map((s) => s.player));
    expect(back.monsters.map((m) => m.monster)).toEqual(preset.monsters.map((m) => m.monster));
  });

  test('rejects other files', () => {
    expect(() => presetFromJson('{}')).toThrow('Not a bulk preset file');
    expect(() => presetFromJson('not json')).toThrow('Not a bulk preset file');
  });
});

describe('importShortlink', () => {
  let mocked: jest.Mock<(id: string) => Promise<ImportableData>>;

  beforeEach(() => {
    mocked = jest.fn<(id: string) => Promise<ImportableData>>();
  });

  test('accepts a share url and loads its loadouts and monster', async () => {
    const raw = fixturePreset();
    mocked.mockResolvedValue({
      serializationVersion: IMPORT_VERSION,
      loadouts: raw.setups.map((s) => s.player),
      selectedLoadout: 0,
      monster: raw.monsters[1].monster,
    } as unknown as ImportableData);

    const result = await importShortlink('https://dps.osrs.wiki/?id=abc', mocked);

    expect(mocked).toHaveBeenCalledWith('abc');
    expect(result.setups.map((s) => s.name)).toEqual(['Whip + defender', 'Claws']);
    expect(result.monster.monster.inputs.phase).toBe('Unshielded');
  });

  test('accepts a bare id', async () => {
    mocked.mockRejectedValue(new Error('Network Error'));

    await expect(importShortlink('xyz', mocked)).rejects.toThrow('Could not load that share link');
    expect(mocked).toHaveBeenCalledWith('xyz');
  });
});
