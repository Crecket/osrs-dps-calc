import { describe, expect, test } from '@jest/globals';
import { RaidStore, RAID_STORAGE_KEY } from '@/raid/state/RaidStore';
import tfa from '@/tests/raid/fixtures/tfaSetup.json';

const memoryStorage = () => {
  const data = new Map<string, unknown>();
  return {
    data,
    getItem: async <T>(key: string) => (data.get(key) as T) ?? null,
    setItem: async <T>(key: string, value: T) => {
      data.set(key, JSON.parse(JSON.stringify(value)));
      return value;
    },
  };
};

const loaded = async (storage = memoryStorage()) => {
  const store = new RaidStore(storage);
  await store.load();
  return store;
};

describe('RaidStore', () => {
  test('defaults and save round trip', async () => {
    const storage = memoryStorage();
    const store = await loaded(storage);
    expect(store.settings.raidId).toBe('fractured-archive');
    expect(store.settings.budget).toBe(100_000_000);
    expect(store.settings.supplies).toEqual({ brews: 6, restores: 5, reserved: 4 });
    expect(store.settings.magic).toBe('thralls');
    store.setBudget(4_000_000_000);
    store.setCount('bork:0', 'elderMaul', 1);
    expect(storage.data.has(RAID_STORAGE_KEY)).toBe(true);
    const again = await loaded(storage);
    expect(again.settings.budget).toBe(4_000_000_000);
    expect(again.settings.counts['bork:0']).toEqual({ elderMaul: 1 });
  });

  test('invalid saved values fall back to defaults', async () => {
    const storage = memoryStorage();
    await storage.setItem(RAID_STORAGE_KEY, { settings: { budget: 'lots', magic: 'zaros', supplies: { brews: -3 } } });
    const store = await loaded(storage);
    expect(store.settings.budget).toBe(100_000_000);
    expect(store.settings.magic).toBe('thralls');
    expect(store.settings.supplies.brews).toBe(6);
  });

  test('blocks thralls through Dagon\'hai', async () => {
    const store = await loaded();
    store.setRoute('fourth', 'dagonhai');
    expect(store.blockReason).toMatch(/Dagon'hai/);
    store.setMagic('standard');
    expect(store.blockReason).toBeNull();
    store.setMagic('thralls');
    store.setRulesOn(false);
    expect(store.blockReason).toBeNull();
  });

  test('required items', async () => {
    const store = await loaded();
    expect(store.requiredIds).toEqual(expect.arrayContaining([21003, 28922, 25818]));
    store.setRoute('third', 'moia');
    expect(store.requiredIds).toContain(27610);
    store.exclude(27610);
    expect(store.requiredIds).not.toContain(27610);
  });

  test('rules off drops boss requirements', async () => {
    const store = await loaded();
    store.setRoute('third', 'moia');
    store.setRulesOn(false);
    expect(store.requiredIds).not.toContain(27610);
  });

  test('importOwned adds the setup\'s items', async () => {
    const store = await loaded();
    expect(store.importOwned(JSON.stringify(tfa))).toBeGreaterThan(10);
    expect(store.settings.ownedIds).toContain(34715);
    expect(() => store.importOwned('nope')).toThrow();
  });

  test('owned and excluded toggle', async () => {
    const store = await loaded();
    store.toggleOwned(20997);
    expect(store.settings.ownedIds).toContain(20997);
    store.toggleOwned(20997);
    expect(store.settings.ownedIds).not.toContain(20997);
    store.exclude(20997);
    expect(store.settings.excludedIds).toContain(20997);
    store.include(20997);
    expect(store.settings.excludedIds).not.toContain(20997);
  });

  test('runKey ignores id order', async () => {
    const a = await loaded();
    const b = await loaded();
    a.toggleOwned(1);
    a.toggleOwned(2);
    b.toggleOwned(2);
    b.toggleOwned(1);
    expect(a.runKey).toBe(b.runKey);
  });

  test('the last result survives a reload', async () => {
    const storage = memoryStorage();
    const store = await loaded(storage);
    store.setResult({ plan: { totalSeconds: 1 } } as never, store.runKey);
    await store.flushResult();
    const again = await loaded(storage);
    expect(again.result?.plan.totalSeconds).toBe(1);
    expect(again.stale).toBe(false);
    again.setBudget(5);
    expect(again.stale).toBe(true);
  });
});
