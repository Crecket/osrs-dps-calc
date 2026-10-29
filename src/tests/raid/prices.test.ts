import {
  beforeEach, describe, expect, test,
} from '@jest/globals';
import {
  fetchPrices, itemPrice, parsePrices, PRICE_CACHE_KEY,
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

beforeEach(() => localStorage.clear());

describe('parsePrices', () => {
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

  test('falls back to the name without its suffix', () => {
    // Venator bow (Charged)
    expect(itemPrice(27610, { byId: new Map(), byName: new Map([['venator bow', 5]]) }, new Set())).toBe(5);
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
    const first = await fetchPrices(okFetch, 1000);
    expect(first?.byId.get(1)).toBe(10);
    // within the hour the cache is used, so a failing fetch doesn't matter
    const cached = await fetchPrices(failingFetch, 1000 + 59 * 60 * 1000);
    expect(cached?.byId.get(1)).toBe(10);
  });

  test('fetch failure gives null and keeps cached prices', async () => {
    expect(await fetchPrices(failingFetch, 1000)).toBeNull();
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({ at: 0, mapping, latest }));
    const stale = await fetchPrices(failingFetch, 10 * 60 * 60 * 1000);
    expect(stale?.byId.get(1)).toBe(10);
  });
});
