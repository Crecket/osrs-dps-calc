import { describe, expect, test } from '@jest/globals';
import v8 from 'node:v8';
import { BEST_STORAGE_KEY, BestStore } from '@/best/state/BestStore';
import type { PresetStorage } from '@/bulk/state/BulkStore';
import { monsterFromSearch } from '@/bulk/lib/presetIO';
import { getMonsters } from '@/lib/Monsters';
import Potion from '@/enums/Potion';
import { BestInputs } from '@/best/types';

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

const flush = () => new Promise((r) => { setTimeout(r, 0); });
const savedInputs = (s: MemoryStorage) => (s.data.get(BEST_STORAGE_KEY) as { inputs: BestInputs }).inputs;
const abyssal = () => monsterFromSearch(getMonsters().find((m) => m.id === 415)!);

describe('BestStore', () => {
  test('load with empty storage gives defaults', async () => {
    const store = new BestStore(new MemoryStorage());
    await store.load();

    expect(store.loaded).toBe(true);
    expect(store.monster).toBeNull();
    expect(store.inputs.skills).toEqual({
      atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
    });
    expect(store.inputs.styles).toEqual(['stab', 'slash', 'crush', 'ranged', 'magic']);
    expect(store.inputs.topN).toBe(5);
    expect(store.inputs.potions).toEqual({});
    expect(store.inputs.conditions.onSlayerTask).toBe(false);
    expect(store.inputs.unlocks.piety).toBe(true);
  });

  test('setters persist and survive a reload', async () => {
    const storage = new MemoryStorage();
    const store = new BestStore(storage);
    await store.load();

    store.setSkills({ atk: 80 });
    store.setUnlocks({ rigour: false });
    store.setConditions({ onSlayerTask: true });
    store.setStyles(['magic']);
    store.setPotions('melee', [Potion.SUPER_COMBAT]);
    store.setTarget(abyssal());
    await flush();

    expect(savedInputs(storage).skills.atk).toBe(80);
    expect(savedInputs(storage).skills.str).toBe(99);

    const again = new BestStore(storage);
    await again.load();
    expect(again.inputs.skills.atk).toBe(80);
    expect(again.inputs.unlocks.rigour).toBe(false);
    expect(again.inputs.unlocks.piety).toBe(true);
    expect(again.inputs.conditions.onSlayerTask).toBe(true);
    expect(again.inputs.styles).toEqual(['magic']);
    expect(again.inputs.potions).toEqual({ melee: [Potion.SUPER_COMBAT] });
    expect(again.monster?.monster.id).toBe(415);
  });

  test('setPotions null removes the override for that group', async () => {
    const store = new BestStore(new MemoryStorage());
    await store.load();
    store.setPotions('melee', [Potion.SUPER_COMBAT]);
    store.setPotions('ranged', [Potion.RANGING]);
    store.setPotions('melee', null);

    expect(store.inputs.potions).toEqual({ ranged: [Potion.RANGING] });
  });

  test('unreadable storage never gets overwritten', async () => {
    const storage = new MemoryStorage();
    storage.getItem = async () => { throw new Error('boom'); };
    const store = new BestStore(storage);
    await store.load();
    store.setSkills({ atk: 1 });
    await flush();

    expect(store.loaded).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  test('runKey is null without a monster and changes with the conditions', async () => {
    const store = new BestStore(new MemoryStorage());
    await store.load();
    expect(store.runKey).toBeNull();

    store.setTarget(abyssal());
    const before = store.runKey;
    expect(before).not.toBeNull();
    store.setConditions({ inWilderness: true });
    expect(store.runKey).not.toBe(before);
  });
});
