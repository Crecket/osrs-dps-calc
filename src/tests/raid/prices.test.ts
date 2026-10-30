import { availableEquipment } from '@/lib/Equipment';
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

  test('an untradeable item made from tradeable parts costs what they do: a Tormented synapse, Hydra leather', () => {
    const parts = { byId: new Map([[29580, 12e6], [22983, 3e6]]), byName: new Map<string, number>() };
    ['Emberlight', 'Scorching bow', 'Purging staff'].forEach((name) => {
      const weapon = availableEquipment.find((e) => e.name === name)!;
      expect(itemPrice(weapon.id, parts, new Set())).toBe(12e6);
      expect(itemPrice(weapon.id, parts, new Set([weapon.id]))).toBe(0);
    });
    expect(itemPrice(availableEquipment.find((e) => e.name === 'Ferocious gloves')!.id, parts, new Set())).toBe(3e6);
    // the Avernic defender stays free
    expect(itemPrice(22322, parts, new Set())).toBe(0);
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
    const first = await fetchPrices(okFetch, 1000);
    expect(first?.byId.get(1)).toBe(10);
    // within the hour the cache is used, so a failing fetch doesn't matter
    const cached = await fetchPrices(failingFetch, 1000 + 59 * 60 * 1000);
    expect(cached?.byId.get(1)).toBe(10);
  });

  test('a snapshot is kept however old when asked to', async () => {
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({ at: 0, mapping, latest }));
    const otherFetch = (async (url: string) => ({
      ok: true,
      json: async () => (String(url).endsWith('/mapping') ? mapping : { data: { 1: { high: 99, low: 1 } } }),
    })) as unknown as typeof fetch;
    const kept = await fetchPrices(otherFetch, 10 * 60 * 60 * 1000, Infinity);
    expect(kept?.byId.get(1)).toBe(10);
    expect(kept?.at).toBe(0);
    const fresh = await fetchPrices(otherFetch, 10 * 60 * 60 * 1000, 0);
    expect(fresh?.byId.get(1)).toBe(99);
  });

  test('fetch failure gives null and keeps cached prices', async () => {
    expect(await fetchPrices(failingFetch, 1000)).toBeNull();
    localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({ at: 0, mapping, latest }));
    const stale = await fetchPrices(failingFetch, 10 * 60 * 60 * 1000);
    expect(stale?.byId.get(1)).toBe(10);
  });
});
