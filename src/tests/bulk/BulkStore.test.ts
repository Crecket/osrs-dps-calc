import { describe, expect, test } from '@jest/globals';
import v8 from 'node:v8';
import { BulkStore, PresetStorage, STORAGE_KEY } from '@/bulk/state/BulkStore';
import { monsterFromSearch, newId } from '@/bulk/lib/presetIO';
import { Prayer } from '@/enums/Prayer';
import { DEFAULT_SETUP_NAMES } from '@/bulk/lib/defaultSetups';
import { getMonsters } from '@/lib/Monsters';
import { generateEmptyPlayer } from '@/state';
import { BulkPreset, LegacyBulkPreset } from '@/bulk/types';
import fixture from './fixtures/preset-v10.json';

class MemoryStorage implements PresetStorage {
  data = new Map<string, unknown>();

  async getItem<T>(key: string): Promise<T | null> {
    return (this.data.get(key) as T) ?? null;
  }

  // clone like IndexedDB does (structured clone), which rejects MobX proxies
  async setItem<T>(key: string, value: T): Promise<T> {
    this.data.set(key, v8.deserialize(v8.serialize(value)));
    return value;
  }
}

const saved = (storage: MemoryStorage) => storage.data.get(STORAGE_KEY) as { presets: BulkPreset[], activeId: string };
// new presets start with the default setups; some tests want an empty one
const clearSetups = (store: BulkStore) => {
  for (const s of [...store.active!.setups]) store.removeSetup(s.id);
};
const abyssal = () => monsterFromSearch(getMonsters().find((m) => m.id === 415)!);

describe('BulkStore', () => {
  test('load creates a default preset', async () => {
    const store = new BulkStore(new MemoryStorage());
    await store.load();

    expect(store.loaded).toBe(true);
    expect(store.presets).toHaveLength(1);
    expect(store.active?.name).toBe('My preset');
    expect(store.active?.setups.map((s) => s.name)).toEqual(DEFAULT_SETUP_NAMES);
  });

  test('mutations persist under dps-bulk-presets and never touch dps-calc-state', async () => {
    const storage = new MemoryStorage();
    const store = new BulkStore(storage);
    await store.load();

    clearSetups(store);
    store.addSetups([{ id: 's1', name: 'Whip', player: generateEmptyPlayer('Whip') }]);
    store.setMonster(abyssal());
    store.renameSetup('s1', 'Whip 2');
    await new Promise((r) => { setTimeout(r, 0); });

    expect([...storage.data.keys()]).toEqual([STORAGE_KEY]);
    expect(saved(storage).presets[0].setups[0].name).toBe('Whip 2');
    expect(saved(storage).presets[0].monster?.monster.id).toBe(415);

    const reloaded = new BulkStore(storage);
    await reloaded.load();
    expect(reloaded.active?.setups[0].name).toBe('Whip 2');
    expect(reloaded.active?.monster?.monster.id).toBe(415);
  });

  test('deletePreset of the active preset activates another', async () => {
    const store = new BulkStore(new MemoryStorage());
    await store.load();
    const first = store.active!;
    const second = store.createPreset('Second');

    expect(store.activeId).toBe(second.id);
    store.deletePreset(second.id);
    expect(store.activeId).toBe(first.id);

    store.deletePreset(first.id);
    expect(store.presets).toHaveLength(1);
    expect(store.active).not.toBeNull();
  });

  test('canRun asks for setups, then a monster', async () => {
    const store = new BulkStore(new MemoryStorage());
    await store.load();

    clearSetups(store);
    expect(store.canRun).toEqual({ ok: false, reason: 'Add at least one setup' });
    store.addSetups([{ id: 's1', name: 'Whip', player: generateEmptyPlayer('Whip') }]);
    expect(store.canRun).toEqual({ ok: false, reason: 'Pick a monster' });
    store.setMonster(abyssal());
    expect(store.canRun).toEqual({ ok: true });
  });

  test('a failed storage read never overwrites saved presets', async () => {
    const storage = new MemoryStorage();
    storage.data.set(STORAGE_KEY, { presets: [], activeId: 'keep-me' });
    storage.getItem = async () => { throw new Error('IndexedDB unavailable'); };
    const store = new BulkStore(storage);

    await store.load();
    store.createPreset('Another');
    await new Promise((r) => { setTimeout(r, 0); });

    expect(store.loaded).toBe(true);
    expect(saved(storage)).toEqual({ presets: [], activeId: 'keep-me' });
    expect(store.warnings.join(' ')).toContain('could not be read');
  });

  test('one broken preset does not block loading the others', async () => {
    const storage = new MemoryStorage();
    const good = new BulkStore(storage);
    await good.load();
    good.renamePreset(good.activeId!, 'Good');
    await new Promise((r) => { setTimeout(r, 0); });
    const data = saved(storage);
    data.presets.push({ id: 'bad', name: 'Broken' } as unknown as BulkPreset);
    storage.data.set(STORAGE_KEY, data);

    const store = new BulkStore(storage);
    await store.load();

    expect(store.loaded).toBe(true);
    expect(store.presets.map((p) => p.name)).toEqual(['Good', 'Broken']);
    expect(store.warnings.join(' ')).toContain('Broken');
  });

  test('removing setups and clearing the monster', async () => {
    const store = new BulkStore(new MemoryStorage());
    await store.load();
    clearSetups(store);
    const m = abyssal();
    store.addSetups([{ id: 's1', name: 'A', player: generateEmptyPlayer('A') }]);
    store.setMonster(m);

    store.removeSetup('s1');
    store.setMonster(null);

    expect(store.active?.setups).toEqual([]);
    expect(store.active?.monster).toBeNull();
  });

  test('identical warnings are shown once', async () => {
    const store = new BulkStore(new MemoryStorage());
    await store.load();
    const raw = JSON.parse(JSON.stringify(fixture.preset)) as LegacyBulkPreset;
    raw.monsters = raw.monsters.slice(0, 1);
    for (const s of raw.setups) {
      s.name = 'Same name';
      s.player.equipment.head = { id: 99999998, name: 'Torva full helm' } as never;
    }

    store.importPreset(raw);

    expect(store.warnings).toHaveLength(1);
  });

  test('adding the same setups twice adds them once', async () => {
    const store = new BulkStore(new MemoryStorage());
    await store.load();
    const before = store.active!.setups.length;
    const make = () => {
      const a = generateEmptyPlayer('A');
      const b = generateEmptyPlayer('B');
      b.prayers = [Prayer.PIETY];
      return [{ id: newId(), name: 'A', player: a }, { id: newId(), name: 'B', player: b }];
    };

    expect(store.addSetups(make())).toEqual({ added: 2, skipped: 0 });
    expect(store.addSetups(make())).toEqual({ added: 0, skipped: 2 });
    expect(store.active!.setups.length).toBe(before + 2);
  });

  test('addDefaultSetups restores deleted defaults only', async () => {
    const store = new BulkStore(new MemoryStorage());
    await store.load();
    store.removeSetup(store.active!.setups.find((s) => s.name === 'Max range')!.id);

    expect(store.addDefaultSetups()).toEqual({ added: 1, skipped: DEFAULT_SETUP_NAMES.length - 1 });
    expect(store.active!.setups).toHaveLength(DEFAULT_SETUP_NAMES.length);
  });

  test('stored legacy presets load', async () => {
    const storage = new MemoryStorage();
    const legacy = JSON.parse(JSON.stringify(fixture.preset)) as LegacyBulkPreset;
    storage.data.set(STORAGE_KEY, { presets: [legacy], activeId: legacy.id });

    const store = new BulkStore(storage);
    await store.load();

    expect(store.active?.id).toBe(legacy.id);
    expect(store.active?.monster?.id).toBe('monster-abyssal');
    expect(store.active?.setups).toHaveLength(2);
  });
});
