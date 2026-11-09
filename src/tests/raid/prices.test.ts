import { availableEquipment } from '@/lib/Equipment';
import {
  beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import {
  fetchPrices, itemPrice, OLD_PRICE_CACHE_KEY, parsePrices, PRICE_CACHE_KEY,
} from '@/raid/lib/prices';

const mapping = [{ id: 1, name: 'A' }, { id: 2, name: 'B' }, { id: 3, name: 'C' }];
const latest = {
  data: {
    1: { high: 10, low: 8 },
    2: { high: null, low: 8 },
    3: { high: null, low: null },
  },
};

const okFetch = (async (url: string) => ({
  ok: true,
  json: async () => (String(url).endsWith('/mapping') ? mapping : latest),
})) as unknown as typeof fetch;
const failingFetch = (async () => {
  throw new Error('offline');
}) as unknown as typeof fetch;

const memoryStorage = () => {
  const data = new Map<string, unknown>();
  return {
    data,
    getItem: async <T>(key: string) => (data.get(key) as T) ?? null,
    setItem: async <T>(key: string, value: T) => {
      data.set(key, value);
      return value;
    },
  };
};
const brokenStorage = () => ({
  getItem: async <T>(): Promise<T | null> => { throw new Error('IndexedDB unavailable'); },
  setItem: async <T>(): Promise<T> => { throw new Error('IndexedDB unavailable'); },
});

beforeEach(() => localStorage.clear());

describe('fetchPrices averages', () => {
  const storage = () => {
    const data = new Map<string, unknown>();
    return {
      data,
      getItem: async <V>(key: string) => (data.get(key) as V) ?? null,
      setItem: async <V>(key: string, value: V) => {
        data.set(key, value);
        return value;
      },
    };
  };
  const respond = (hourOk: boolean) => (async (url: string) => {
    const path = String(url);
    if (path.endsWith('/1h')) return { ok: hourOk, status: hourOk ? 200 : 500, json: async () => ({ data: { 1: { avgHighPrice: 7, avgLowPrice: 6 } } }) };
    return { ok: true, status: 200, json: async () => (path.endsWith('/mapping') ? [{ id: 1, name: 'A' }] : { data: { 1: { high: 900, low: 5 } } }) };
  }) as unknown as typeof fetch;

  test('uses and keeps the averages', async () => {
    const s = storage();
    expect((await fetchPrices(respond(true), 1, 0, s))?.byId.get(1)).toBe(7);
    // from the saved snapshot now, which must give the same prices
    expect((await fetchPrices(respond(false), 2, Infinity, s))?.byId.get(1)).toBe(7);
  });

  test('without the averages the latest prices still do', async () => {
    expect((await fetchPrices(respond(false), 1, 0, storage()))?.byId.get(1)).toBe(900);
  });
});

describe('parsePrices', () => {
  test('prefers the last hour\'s average, so one odd trade doesn\'t set the price', () => {
    const raw = {
      data: {
        1: { high: 900, low: 8 }, 2: { high: 20, low: 18 }, 3: { high: 30, low: 28 }, 4: { high: null, low: 40 },
      },
    };
    const hour = { data: { 1: { avgHighPrice: 10, avgLowPrice: 9 }, 2: { avgHighPrice: null, avgLowPrice: 19 }, 3: { avgHighPrice: null, avgLowPrice: null } } };
    const { byId } = parsePrices([], raw, hour);
    expect(byId.get(1)).toBe(10);
    expect(byId.get(2)).toBe(19);
    expect(byId.get(3)).toBe(30);
    expect(byId.get(4)).toBe(40);
  });

  test('parse picks high then low', () => {
    const { byId, byName } = parsePrices(mapping, latest);
    expect(byId.get(1)).toBe(10);
    expect(byId.get(2)).toBe(8);
    expect(byId.has(3)).toBe(false);
    expect(byName.get('a')).toBe(10);
  });
});

describe('itemPrice', () => {
  const prices = { byId: new Map([[27610, 7]]), byName: new Map<string, number>() };

  test('priced by id', () => {
    expect(itemPrice(27610, prices, new Set())).toBe(7);
  });

  test('owned is free', () => {
    expect(itemPrice(27610, prices, new Set([27610]))).toBe(0);
  });

  test('an untradeable item made from tradeable parts costs what they do: a Tormented synapse, Hydra leather', () => {
    const parts = { byId: new Map([[29580, 12e6], [22983, 3e6]]), byName: new Map<string, number>() };
    ['Emberlight', 'Scorching bow', 'Purging staff'].forEach((name) => {
      const weapon = availableEquipment.find((e) => e.name === name)!;
      expect(itemPrice(weapon.id, parts, new Set())).toBe(12e6);
      expect(itemPrice(weapon.id, parts, new Set([weapon.id]))).toBe(0);
    });
    expect(itemPrice(availableEquipment.find((e) => e.name === 'Ferocious gloves')!.id, parts, new Set())).toBe(3e6);
  });

  test('the Avernic defender costs its hilt, Ghommal\'s too, and Avernic treads (max) the treads, three boots and demon tears', () => {
    const parts = {
      byId: new Map([[22477, 60e6], [31088, 140e6], [13239, 16e6], [13237, 33e6], [13235, 3e6], [31111, 100]]),
      byName: new Map([['avernic treads', 140e6]]),
    };
    expect(itemPrice(22322, parts, new Set())).toBe(60e6);
    expect(itemPrice(27550, parts, new Set())).toBe(60e6);
    expect(itemPrice(31097, parts, new Set())).toBe(140e6 + 16e6 + 33e6 + 3e6 + 12_000 * 100);
    expect(itemPrice(31088, parts, new Set())).toBe(140e6);
  });

  test('an untradeable upgrade costs the item plus its upgrade: the Saradomin\'s blessed sword, Neitiznot faceguard', () => {
    const parts = {
      byId: new Map([[11838, 100_000], [12804, 5e6], [10828, 40_000], [24268, 10e6]]), byName: new Map<string, number>(),
    };
    expect(itemPrice(12808, parts, new Set())).toBe(5.1e6);
    expect(itemPrice(24271, parts, new Set())).toBe(10.04e6);
  });

  test('falls back to the name without its suffix', () => {
    // Venator bow (Charged)
    expect(itemPrice(27610, { byId: new Map(), byName: new Map([['venator bow', 5]]) }, new Set())).toBe(5);
  });

  test('a charged item is priced by its tradeable version', () => {
    // the Obligator (Charged) 34715 isn't on the GE; the Obligator (Uncharged) 34717 is
    expect(itemPrice(34715, { byId: new Map([[34717, 3e9]]), byName: new Map() }, new Set())).toBe(3e9);
  });

  test('a clan or corrupted version is priced by the tradeable base item', () => {
    // Bow of Faerdhinen (c) (Amlodd) 25896 -> Bow of Faerdhinen (Inactive) 25862
    expect(itemPrice(25896, { byId: new Map([[25862, 40e6]]), byName: new Map() }, new Set())).toBe(40e6);
    // Crystal body (Amlodd) 27769 -> Crystal body (Inactive) 23977
    expect(itemPrice(27769, { byId: new Map([[23977, 15e6]]), byName: new Map() }, new Set())).toBe(15e6);
  });

  test('an ornament copy costs what its base item costs', () => {
    // Holy Scythe of Vitur 25736 has the Scythe of Vitur's stats; the scythe is on the GE uncharged (22486)
    expect(itemPrice(25736, { byId: new Map([[22486, 1.2e9]]), byName: new Map() }, new Set())).toBe(1.2e9);
  });

  test('untradeable is free', () => {
    expect(itemPrice(27610, { byId: new Map(), byName: new Map() }, new Set())).toBe(0);
  });

  test('no prices at all is free', () => {
    expect(itemPrice(27610, null, new Set())).toBe(0);
  });
});

describe('fetchPrices', () => {
  test('fetches and caches for an hour', async () => {
    const storage = memoryStorage();
    const first = await fetchPrices(okFetch, 1000, undefined, storage);
    expect(first?.byId.get(1)).toBe(10);
    // within the hour the cache is used, so a failing fetch doesn't matter
    const cached = await fetchPrices(failingFetch, 1000 + 59 * 60 * 1000, undefined, storage);
    expect(cached?.byId.get(1)).toBe(10);
  });

  test('a snapshot is kept however old when asked to', async () => {
    const storage = memoryStorage();
    await storage.setItem(PRICE_CACHE_KEY, { at: 0, mapping, latest });
    const otherFetch = (async (url: string) => ({
      ok: true,
      json: async () => (String(url).endsWith('/mapping') ? mapping : { data: { 1: { high: 99, low: 1 } } }),
    })) as unknown as typeof fetch;
    const kept = await fetchPrices(otherFetch, 10 * 60 * 60 * 1000, Infinity, storage);
    expect(kept?.byId.get(1)).toBe(10);
    expect(kept?.at).toBe(0);
    const fresh = await fetchPrices(otherFetch, 10 * 60 * 60 * 1000, 0, storage);
    expect(fresh?.byId.get(1)).toBe(99);
  });

  test('fetch failure gives null and keeps cached prices', async () => {
    const storage = memoryStorage();
    expect(await fetchPrices(failingFetch, 1000, undefined, storage)).toBeNull();
    await storage.setItem(PRICE_CACHE_KEY, { at: 0, mapping, latest });
    const stale = await fetchPrices(failingFetch, 10 * 60 * 60 * 1000, undefined, storage);
    expect(stale?.byId.get(1)).toBe(10);
    expect(stale?.at).toBe(0);
    expect(stale?.fetchFailed).toBe(true);
  });

  test('only a failed fetch is marked as failed', async () => {
    const storage = memoryStorage();
    expect((await fetchPrices(okFetch, 1000, undefined, storage))?.fetchFailed).toBeUndefined();
    // from the cache, without fetching
    expect((await fetchPrices(failingFetch, 2000, undefined, storage))?.fetchFailed).toBeUndefined();
    expect((await fetchPrices(okFetch, 3000, 0, storage))?.fetchFailed).toBeUndefined();
    expect((await fetchPrices(failingFetch, 4000, 0, storage))?.fetchFailed).toBe(true);
  });

  test('the snapshot in localStorage moves to storage, keeping its age, however old it is', async () => {
    const storage = memoryStorage();
    localStorage.setItem(OLD_PRICE_CACHE_KEY, JSON.stringify({ at: 5, mapping, latest }));
    const moved = await fetchPrices(failingFetch, 10 * 60 * 60 * 1000, Infinity, storage);
    expect(moved?.at).toBe(5);
    expect(moved?.byId.get(1)).toBe(10);
    expect(moved?.fetchFailed).toBeUndefined();
    expect(localStorage.getItem(OLD_PRICE_CACHE_KEY)).toBeNull();
    expect(storage.data.get(PRICE_CACHE_KEY)).toEqual({ at: 5, mapping, latest });

    const again = await fetchPrices(failingFetch, 10 * 60 * 60 * 1000, Infinity, storage);
    expect(again?.at).toBe(5);
  });

  test('storage that fails is not fatal, and the snapshot in localStorage stays for later', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    localStorage.setItem(OLD_PRICE_CACHE_KEY, JSON.stringify({ at: 5, mapping, latest }));
    expect((await fetchPrices(failingFetch, 1000, Infinity, brokenStorage()))?.at).toBe(5);
    expect(localStorage.getItem(OLD_PRICE_CACHE_KEY)).not.toBeNull();

    // no snapshot: fetched prices still work for this page load, and the old snapshot doesn't go until they're saved
    expect((await fetchPrices(okFetch, 1000, 0, brokenStorage()))?.byId.get(1)).toBe(10);
    expect(localStorage.getItem(OLD_PRICE_CACHE_KEY)).not.toBeNull();
    localStorage.clear();
    expect((await fetchPrices(okFetch, 1000, undefined, brokenStorage()))?.byId.get(1)).toBe(10);
    expect(await fetchPrices(failingFetch, 1000, undefined, brokenStorage())).toBeNull();
    warn.mockRestore();
  });

  test('an unreadable snapshot in localStorage is removed', async () => {
    const storage = memoryStorage();
    localStorage.setItem(OLD_PRICE_CACHE_KEY, '{nope');
    expect(await fetchPrices(failingFetch, 1000, undefined, storage)).toBeNull();
    expect(localStorage.getItem(OLD_PRICE_CACHE_KEY)).toBeNull();
  });

  test('a newer save removes a snapshot that could not be moved earlier', async () => {
    const storage = memoryStorage();
    await storage.setItem(PRICE_CACHE_KEY, { at: 9, mapping, latest });
    localStorage.setItem(OLD_PRICE_CACHE_KEY, JSON.stringify({ at: 5, mapping, latest }));
    expect((await fetchPrices(failingFetch, 1000, Infinity, storage))?.at).toBe(9);
    await fetchPrices(okFetch, 1000, 0, storage);
    expect(localStorage.getItem(OLD_PRICE_CACHE_KEY)).toBeNull();
  });
});
