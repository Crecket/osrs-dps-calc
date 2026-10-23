/**
 * Loading and saving bulk presets. Imported data is always passed through upstream's own import logic
 * (GlobalState.updateImportedData) on a scratch store, so upstream's migrations and item re-resolution apply to presets
 * exactly as they do to the calculator's share links and saved sessions.
 */
import localforage from 'localforage';
import { toJS } from 'mobx';
import { GlobalState } from '@/state';
import { getMonsters, INITIAL_MONSTER_INPUTS } from '@/lib/Monsters';
import { fetchShortlinkData, WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';
import { IMPORT_VERSION, ImportableData } from '@/types/State';
import { Monster } from '@/types/Monster';
import { Player, PlayerEquipment } from '@/types/Player';
import { prepareMonster } from '@/bulk/lib/compute';
import { BulkMonster, BulkPreset, BulkSetup } from '@/bulk/types';

const FILE_KIND = 'dps-bulk-preset';
const FILE_VERSION = 1;

export const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v, WORKER_JSON_REPLACER), WORKER_JSON_REVIVER);

/**
 * @param names display names for the loadouts (preset setup names), used in warnings; defaults to the loadout names
 */
export const migrateImportable = (data: ImportableData, names?: string[]): { setups: BulkSetup[]; monster: BulkMonster; warnings: string[] } => {
  const input = clone(data);
  input.loadouts = input.loadouts || [];
  input.monster.inputs = input.monster.inputs || ({} as Monster['inputs']);
  input.monster.inputs.defenceReductions = input.monster.inputs.defenceReductions
    || { ...INITIAL_MONSTER_INPUTS.defenceReductions };
  const hadCurrentHp = input.monster.inputs.monsterCurrentHp !== undefined;

  // remember which item ids were saved, so that we can report items that no longer exist
  const savedItems = input.loadouts.map((l) => Object.entries(l.equipment || {})
    .filter(([, v]) => v && Object.hasOwn(v, 'id'))
    .map(([slot, v]) => ({ slot, ...(v as { id: number; name?: string }) })));

  const scratch = new GlobalState();
  scratch.updateImportedData(input);

  const loadouts = (toJS(scratch.loadouts) as Player[]).slice(0, input.loadouts.length);
  const warnings: string[] = [];
  const setups = loadouts.map((player, i): BulkSetup => {
    for (const { slot, id, name } of savedItems[i]) {
      // a two-handed weapon drops the shield; the shield still exists
      const droppedFor2h = slot === 'shield' && player.equipment.weapon?.isTwoHanded;
      if (player.equipment[slot as keyof PlayerEquipment] === null && !droppedFor2h) {
        warnings.push(`${names?.[i] || player.name}: ${name || `item ${id}`} (${slot}) no longer exists and was removed`);
      }
    }
    return { id: newId(), name: player.name, player };
  });

  // the migrations above were applied to input.monster.inputs in place
  const { inputs, ...base } = toJS(scratch.monster);
  const migratedInputs: Partial<Monster['inputs']> = { ...inputs, ...input.monster.inputs };
  if (!hadCurrentHp) delete migratedInputs.monsterCurrentHp;
  const monster = prepareMonster(base, migratedInputs);

  return { setups, monster: { id: newId(), monster }, warnings };
};

export const loadPreset = (raw: BulkPreset): { preset: BulkPreset; warnings: string[] } => {
  const warnings: string[] = [];

  // setups don't depend on the monster, so any monster will do for migrating them
  const migrateSetups = (list: BulkSetup[]): BulkSetup[] => {
    const result = migrateImportable({
      serializationVersion: raw.serializationVersion,
      loadouts: list.map((s) => s.player),
      selectedLoadout: 0,
      monster: prepareMonster(getMonsters()[0]),
    }, list.map((s) => s.name));
    warnings.push(...result.warnings);
    return result.setups.map((s, ix) => ({ ...s, id: list[ix].id, name: list[ix].name }));
  };

  let setups: BulkSetup[];
  try {
    setups = raw.setups.length > 0 ? migrateSetups(raw.setups) : [];
  } catch (e) {
    // one by one, so that a single broken setup doesn't take the others with it
    setups = raw.setups.flatMap((s) => {
      try {
        return migrateSetups([s]);
      } catch (err) {
        warnings.push(`${s.name}: could not be loaded and was removed`);
        return [];
      }
    });
  }

  const monsters: BulkMonster[] = [];
  for (const entry of raw.monsters) {
    try {
      const { monster } = migrateImportable({
        serializationVersion: raw.serializationVersion,
        loadouts: [],
        selectedLoadout: 0,
        monster: entry.monster,
      });
      monsters.push({ ...monster, id: entry.id });
    } catch (e) {
      warnings.push(`${entry.monster.name || `Monster ${entry.monster.id}`} no longer exists and was removed`);
    }
  }

  return {
    preset: {
      ...raw,
      serializationVersion: IMPORT_VERSION,
      setups,
      monsters,
    },
    warnings,
  };
};

export const fromCalculatorState = (state: ImportableData, which: 'all' | number): { setups: BulkSetup[]; monster: BulkMonster } => {
  const { setups, monster } = migrateImportable(state);
  return {
    setups: which === 'all' ? setups : setups.slice(which, which + 1),
    monster,
  };
};

export const readCalculatorState = async (): Promise<ImportableData | null> => {
  const state = await localforage.getItem<ImportableData>('dps-calc-state');
  return state || null;
};

export const importShortlink = async (
  input: string,
  fetchData: (id: string) => Promise<ImportableData> = fetchShortlinkData,
): Promise<{ setups: BulkSetup[]; monster: BulkMonster }> => {
  const trimmed = input.trim();
  const match = trimmed.match(/[?&]id=([^&#]+)/);
  const id = match ? decodeURIComponent(match[1]) : trimmed;

  let data: ImportableData;
  try {
    data = await fetchData(id);
  } catch (e) {
    throw new Error('Could not load that share link (the Wiki may block requests from this site).');
  }

  return fromCalculatorState(data, 'all');
};

export const monsterFromSearch = (base: Omit<Monster, 'inputs'>): BulkMonster => ({
  id: newId(),
  monster: prepareMonster(base),
});

export const presetToJson = (p: BulkPreset): string => JSON.stringify(
  { kind: FILE_KIND, version: FILE_VERSION, preset: p },
  WORKER_JSON_REPLACER,
  2,
);

export const presetFromJson = (text: string): BulkPreset => {
  let parsed: { kind?: string; preset?: BulkPreset };
  try {
    parsed = JSON.parse(text, WORKER_JSON_REVIVER);
  } catch (e) {
    throw new Error('Not a bulk preset file');
  }

  const p = parsed?.preset;
  if (parsed?.kind !== FILE_KIND || !p || !Array.isArray(p.setups) || !Array.isArray(p.monsters)) {
    throw new Error('Not a bulk preset file');
  }

  const now = Date.now();
  return {
    ...p,
    id: newId(),
    name: p.name || 'Imported preset',
    createdAt: now,
    updatedAt: now,
    serializationVersion: p.serializationVersion || IMPORT_VERSION,
    setups: p.setups.map((s) => ({ ...s, id: newId() })),
    monsters: p.monsters.map((m) => ({ ...m, id: newId() })),
  };
};
