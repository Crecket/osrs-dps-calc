import { describe, expect, test } from '@jest/globals';
import v8 from 'node:v8';
import { BEST_STORAGE_KEY, BestStore } from '@/best/state/BestStore';
import type { PresetStorage } from '@/bulk/state/BulkStore';
import { monsterFromSearch } from '@/bulk/lib/presetIO';
import { getMonsters } from '@/lib/Monsters';
import Potion from '@/enums/Potion';
import { Prayer } from '@/enums/Prayer';
import { BestInputs } from '@/best/types';
import TargetSync from '@/bulk/state/TargetSync';
import { GlobalState } from '@/state';

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

  test('runKey ignores the order potion groups were set in', async () => {
    const a = new BestStore(new MemoryStorage());
    const b = new BestStore(new MemoryStorage());
    await a.load();
    await b.load();
    a.setTarget(abyssal());
    b.setTarget(abyssal());
    a.setPotions('melee', [Potion.SUPER_COMBAT]);
    a.setPotions('ranged', [Potion.RANGING]);
    b.setPotions('ranged', [Potion.RANGING]);
    b.setPotions('melee', [Potion.SUPER_COMBAT]);

    expect(a.runKey).toBe(b.runKey);
  });

  test('runKey changes with styles, potions, skills and the monster', async () => {
    const store = new BestStore(new MemoryStorage());
    await store.load();
    store.setTarget(abyssal());
    const keys = [store.runKey];
    store.setStyles(['magic']);
    keys.push(store.runKey);
    store.setPotions('magic', [Potion.SATURATED_HEART]);
    keys.push(store.runKey);
    store.setSkills({ atk: 70 });
    keys.push(store.runKey);
    store.setTarget(monsterFromSearch(getMonsters().find((m) => m.id !== 415)!));
    keys.push(store.runKey);

    expect(new Set(keys).size).toBe(keys.length);
  });

  test('setPrayerOverride saves per group; null goes back to Auto; runKey ignores the order groups were set in', async () => {
    const storage = new MemoryStorage();
    const a = new BestStore(storage);
    await a.load();
    a.setTarget(abyssal());
    const auto = a.runKey;
    a.setPrayerOverride('melee', [Prayer.SUPERHUMAN_STRENGTH]);
    a.setPrayerOverride('ranged', []);
    expect(a.runKey).not.toBe(auto);
    await flush();
    expect(savedInputs(storage).prayerOverrides).toEqual({ melee: [Prayer.SUPERHUMAN_STRENGTH], ranged: [] });

    const b = new BestStore(new MemoryStorage());
    await b.load();
    b.setTarget(abyssal());
    b.setPrayerOverride('ranged', []);
    b.setPrayerOverride('melee', [Prayer.SUPERHUMAN_STRENGTH]);
    expect(b.runKey).toBe(a.runKey);

    a.setPrayerOverride('melee', null);
    a.setPrayerOverride('ranged', null);
    expect(a.runKey).toBe(auto);
  });

  test('setTarget before load leaves storage untouched and load keeps the saved state', async () => {
    const storage = new MemoryStorage();
    const first = new BestStore(storage);
    await first.load();
    first.setSkills({ atk: 42 });
    first.setTarget(abyssal());
    await flush();

    const store = new BestStore(storage);
    expect(store.canSave).toBe(false);
    store.setTarget(monsterFromSearch(getMonsters().find((m) => m.id !== 415)!));
    store.setSkills({ atk: 1 });
    await flush();
    expect(savedInputs(storage).skills.atk).toBe(42);

    await store.load();
    expect(store.inputs.skills.atk).toBe(42);
    expect(store.monster?.monster.id).toBe(415);
    expect(store.canSave).toBe(true);
  });

  test('canSave stays false when the saved state could not be read', async () => {
    const storage = new MemoryStorage();
    storage.getItem = async () => { throw new Error('boom'); };
    const store = new BestStore(storage);
    await store.load();

    expect(store.canSave).toBe(false);
  });

  describe('with TargetSync started before load', () => {
    test('ends with the saved monster', async () => {
      const storage = new MemoryStorage();
      const first = new BestStore(storage);
      await first.load();
      first.setTarget(abyssal());
      await flush();

      const store = new BestStore(storage);
      const calc = new GlobalState();
      const sync = new TargetSync(store, calc, 0);
      sync.start();
      await store.load();
      await flush();

      expect(store.monster?.monster.id).toBe(415);
      expect(calc.monster.id).toBe(415);
      expect((storage.data.get(BEST_STORAGE_KEY) as { monster: { monster: { id: number } } }).monster.monster.id).toBe(415);
      sync.dispose();
    });

    test('adopts the panel monster when nothing was saved', async () => {
      const storage = new MemoryStorage();
      const store = new BestStore(storage);
      const calc = new GlobalState();
      const sync = new TargetSync(store, calc, 0);
      sync.start();
      expect(store.monster).toBeNull();
      await store.load();
      await flush();

      expect(store.monster?.monster.id).toBe(calc.monster.id);
      expect(storage.data.has(BEST_STORAGE_KEY)).toBe(true);
      sync.dispose();
    });
  });

  describe('load validation', () => {
    const loadWith = async (raw: unknown) => {
      const storage = new MemoryStorage();
      storage.data.set(BEST_STORAGE_KEY, raw);
      const store = new BestStore(storage);
      await store.load();
      return store;
    };
    const defaults = async () => (await loadWith(null)).inputs;

    test('garbage values fall back to defaults', async () => {
      const store = await loadWith({
        inputs: {
          evil: 1,
          skills: { atk: 'a', str: 50, bogus: 3 },
          unlocks: { piety: 'yes', rigour: false, prayerLevel: null },
          conditions: {
            onSlayerTask: 3, soulreaperStacks: 'x', currentHp: 'x', inWilderness: true,
          },
          styles: ['magic', 'nonsense'],
          topN: -2,
          potions: { melee: [Potion.SUPER_COMBAT, 'x', 9999], other: [1], ranged: 'no' },
          // a valid ranged choice, a magic prayer under melee, an unknown group, a non-prayer
          prayerOverrides: {
            ranged: [Prayer.HAWK_EYE], melee: [Prayer.AUGURY], other: [], magic: [9999],
          },
        },
        monster: { id: 'x' },
      });
      const d = await defaults();

      expect(store.inputs).not.toHaveProperty('evil');
      expect(store.inputs.skills).not.toHaveProperty('bogus');
      expect(store.inputs.skills.atk).toBe(99);
      expect(store.inputs.skills.str).toBe(50);
      expect(store.inputs.unlocks.piety).toBe(d.unlocks.piety);
      expect(store.inputs.unlocks.rigour).toBe(false);
      expect(store.inputs.unlocks.prayerLevel).toBe(d.unlocks.prayerLevel);
      expect(store.inputs.conditions.onSlayerTask).toBe(false);
      expect(store.inputs.conditions.soulreaperStacks).toBe(d.conditions.soulreaperStacks);
      expect(store.inputs.conditions.currentHp).toBeNull();
      expect(store.inputs.conditions.inWilderness).toBe(true);
      expect(store.inputs.styles).toEqual(['magic']);
      expect(store.inputs.topN).toBe(5);
      expect(store.inputs.potions).toEqual({ melee: [Potion.SUPER_COMBAT] });
      expect(store.inputs.prayerOverrides).toEqual({ ranged: [Prayer.HAWK_EYE] });
      expect(store.monster).toBeNull();
    });

    test.each([
      [null], [42], ['str'], [[]], [{}], [{ inputs: 'x', monster: 3 }], [{ inputs: { styles: [], topN: 2.5, skills: 4 } }],
    ])('unusable saved data %j loads defaults', async (raw) => {
      const store = await loadWith(raw);
      const d = await defaults();

      expect(store.loaded).toBe(true);
      expect(store.inputs).toEqual(d);
      expect(store.monster).toBeNull();
    });

    test('older partial data keeps what is valid', async () => {
      const store = await loadWith({ inputs: { skills: { atk: 60 }, topN: 8 }, monster: abyssal() });

      expect(store.inputs.skills.atk).toBe(60);
      expect(store.inputs.skills.def).toBe(99);
      expect(store.inputs.topN).toBe(8);
      expect(store.monster?.monster.id).toBe(415);
    });
  });
});
