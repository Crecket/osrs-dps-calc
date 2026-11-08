import {
  describe, expect, jest, test,
} from '@jest/globals';
import {
  SEARCH_CACHE_KEY, SearchCache, SPEC_CACHE_KEY, StoredCandidate,
} from '@/raid/lib/searchCache';

const memoryStorage = () => {
  const data = new Map<string, unknown>();
  const writes: string[] = [];
  return {
    data,
    writes,
    getItem: async <T>(key: string) => (data.get(key) as T) ?? null,
    setItem: async <T>(key: string, value: T) => {
      writes.push(key);
      data.set(key, JSON.parse(JSON.stringify(value)));
      return value;
    },
    removeItem: async (key: string) => {
      data.delete(key);
    },
  };
};

const stored = (dps: number) => [{ dps }] as unknown as StoredCandidate[];

describe('SearchCache', () => {
  test('searches and spec lookups come back after a reload', async () => {
    const storage = memoryStorage();
    const cache = new SearchCache(storage);
    cache.set('a', stored(1));
    cache.setSpec('s', 5);
    await cache.flush();

    const again = new SearchCache(storage);
    await again.load();
    expect(again.peek('a')).toEqual(stored(1));
    expect(again.getSpec('s')).toBe(5);
  });

  test('a write only rewrites what changed', async () => {
    const storage = memoryStorage();
    const cache = new SearchCache(storage);
    cache.setSpec('s', 5);
    await cache.flush();
    expect(storage.writes).toEqual([SPEC_CACHE_KEY]);

    storage.writes.length = 0;
    cache.set('a', stored(1));
    await cache.flush();
    expect(storage.writes).toEqual([SEARCH_CACHE_KEY]);

    storage.writes.length = 0;
    await cache.flush();
    expect(storage.writes).toEqual([]);
  });

  test('a use alone writes nothing, and its order is saved with the next write', async () => {
    const storage = memoryStorage();
    const cache = new SearchCache(storage, 2);
    cache.set('a', stored(1));
    cache.set('b', stored(2));
    await cache.flush();

    storage.writes.length = 0;
    cache.get('a');
    await cache.flush();
    expect(storage.writes).toEqual([]);

    cache.setSpec('s', 5);
    await cache.flush();
    expect(storage.writes.sort()).toEqual([SEARCH_CACHE_KEY, SPEC_CACHE_KEY].sort());

    // 'a' was used last, so a new search pushes out 'b'
    const again = new SearchCache(storage, 2);
    await again.load();
    again.set('c', stored(3));
    expect(again.has('a')).toBe(true);
    expect(again.has('b')).toBe(false);
  });

  test('entries from another version, in the old form too, are deleted', async () => {
    const storage = memoryStorage();
    storage.data.set(SEARCH_CACHE_KEY, { version: 'old', entries: [['a', stored(1)]], specs: [['s', 5]] });
    storage.data.set(SPEC_CACHE_KEY, { version: 'old', specs: [['s', 5]] });
    const cache = new SearchCache(storage);
    await cache.load();
    expect(cache.has('a')).toBe(false);
    expect(cache.getSpec('s')).toBeUndefined();
    expect(storage.data.size).toBe(0);
  });

  test('a failed read starts empty and a failed write is not fatal', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const storage = memoryStorage();
    storage.getItem = async () => { throw new Error('IndexedDB unavailable'); };
    storage.setItem = async () => { throw new Error('quota exceeded'); };
    const cache = new SearchCache(storage);
    await cache.load();
    expect(cache.has('a')).toBe(false);
    cache.set('a', stored(1));
    await cache.flush();
    expect(cache.peek('a')).toEqual(stored(1));
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
