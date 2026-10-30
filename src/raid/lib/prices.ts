import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import { EquipmentPiece } from '@/types/Player';

const API = 'https://prices.runescape.wiki/api/v1/osrs';
export const PRICE_CACHE_KEY = 'raid-prices-v1';
const MAX_AGE = 60 * 60 * 1000;

export type PriceTable = Map<number, number>;

export interface Prices {
  /** When the prices were fetched (ms since epoch) */
  at?: number;
  byId: PriceTable;
  /** Lower-cased item name -> price */
  byName: Map<string, number>;
}

type Mapping = { id: number; name: string }[];
type Latest = { data: Record<string, { high: number | null; low: number | null }> };

/** Instant-buy price (high), else instant-sell (low); items with neither are left out */
export const parsePrices = (mapping: Mapping, latest: Latest): Prices => {
  const byId: PriceTable = new Map();
  Object.entries(latest.data).forEach(([id, p]) => {
    const price = p.high ?? p.low;
    if (price !== null && price !== undefined) byId.set(Number(id), price);
  });
  const byName = new Map<string, number>();
  mapping.forEach((m) => {
    const price = byId.get(m.id);
    if (price !== undefined) byName.set(m.name.toLowerCase(), price);
  });
  return { byId, byName };
};

const readCache = (): { at: number; mapping: Mapping; latest: Latest } | null => {
  try {
    const raw = localStorage.getItem(PRICE_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const withAt = (p: Prices, at: number): Prices => ({ ...p, at });

/**
 * Wiki prices, from a cache younger than `maxAge` or fetched; a failed fetch falls back to an older cache, else null.
 * The page keeps its snapshot (maxAge Infinity) so searches keyed on price tiers stay cached until prices are refreshed.
 */
export const fetchPrices = async (fetchFn: typeof fetch = fetch, now = Date.now(), maxAge = MAX_AGE): Promise<Prices | null> => {
  const cached = readCache();
  if (cached && now - cached.at < maxAge) return withAt(parsePrices(cached.mapping, cached.latest), cached.at);
  try {
    const get = async (path: string) => {
      const res = await fetchFn(`${API}/${path}`);
      if (!res.ok) throw new Error(`${path}: ${res.status}`);
      return res.json();
    };
    const [mapping, latest] = await Promise.all([get('mapping'), get('latest')]);
    try {
      localStorage.setItem(PRICE_CACHE_KEY, JSON.stringify({ at: now, mapping, latest }));
    } catch {
      // storage full or blocked: the prices still work for this page load
    }
    return withAt(parsePrices(mapping, latest), now);
  } catch (e) {
    console.warn('[raid] Could not fetch prices', e);
    return cached ? withAt(parsePrices(cached.mapping, cached.latest), cached.at) : null;
  }
};

let itemsById: Map<number, EquipmentPiece> | null = null;
const itemById = (id: number) => {
  if (!itemsById) itemsById = new Map(availableEquipment.map((e) => [e.id, e]));
  return itemsById.get(id);
};

// every version of an item by name, e.g. the Charged and Uncharged Obligator; often only one is on the GE
let idsByName: Map<string, number[]> | null = null;
const versionIds = (name: string) => {
  if (!idsByName) {
    idsByName = new Map();
    availableEquipment.forEach((e) => idsByName!.set(e.name, [...(idsByName!.get(e.name) ?? []), e.id]));
  }
  return idsByName.get(name) ?? [];
};

// getCanonicalItemId scans every alias; the tiers price thousands of items on each settings change
const canonicalIds = new Map<number, number>();
const canonicalOf = (id: number) => {
  let canonical = canonicalIds.get(id);
  if (canonical === undefined) {
    canonical = getCanonicalItemId(id);
    canonicalIds.set(id, canonical);
  }
  return canonical;
};

/** The name, then the name without each trailing "(…)" in turn: "Bow of Faerdhinen (c) (Amlodd)", "… (c)", "…" */
const shorterNames = (name: string): string[] => {
  const names = [name];
  for (;;) {
    const shorter = names[names.length - 1].replace(/\s*\([^)]*\)$/, '');
    if (shorter === names[names.length - 1] || !shorter) return names;
    names.push(shorter);
  }
};

// ornament copies the aliases miss: "<prefix> <name>" with the same stats as "<name>", e.g. the Holy Scythe of Vitur
let baseNames: Map<number, string> | null = null;
const baseName = (id: number) => {
  if (!baseNames) {
    const statsKey = (e: EquipmentPiece) => JSON.stringify([e.slot, e.offensive, e.defensive, e.bonuses, e.speed, e.category]);
    const namesByStats = new Map<string, string[]>();
    availableEquipment.forEach((e) => namesByStats.set(statsKey(e), [...(namesByStats.get(statsKey(e)) ?? []), e.name]));
    baseNames = new Map();
    availableEquipment.forEach((e) => {
      const base = namesByStats.get(statsKey(e))!.find((n) => e.name.toLowerCase().endsWith(` ${n.toLowerCase()}`));
      if (base) baseNames!.set(e.id, base);
    });
  }
  return baseNames.get(id);
};

/**
 * Untradeable items made from tradeable parts, which cost what the parts do (from the osrs-price-index composites).
 * The Avernic defender and Avernic treads (max) are left free on purpose.
 */
const RECIPES: Record<string, { itemId: number; qty: number }[]> = {
  'Ferocious gloves': [{ itemId: 22983, qty: 1 }], // Hydra leather
  Emberlight: [{ itemId: 29580, qty: 1 }], // Tormented synapse
  'Scorching bow': [{ itemId: 29580, qty: 1 }],
  'Purging staff': [{ itemId: 29580, qty: 1 }],
  'Amulet of blood fury': [{ itemId: 6585, qty: 1 }, { itemId: 24777, qty: 1 }], // Amulet of fury, Blood shard
  "Elidinis' ward (f)": [{ itemId: 25985, qty: 1 }, { itemId: 12827, qty: 1 }, { itemId: 566, qty: 10_000 }], // ward, Arcane sigil, Soul runes
  'Harmonised Nightmare staff': [{ itemId: 24422, qty: 1 }, { itemId: 24511, qty: 1 }], // Nightmare staff and its orb
  'Volatile Nightmare staff': [{ itemId: 24422, qty: 1 }, { itemId: 24514, qty: 1 }],
  'Eldritch Nightmare staff': [{ itemId: 24422, qty: 1 }, { itemId: 24517, qty: 1 }],
};

/**
 * What the item costs to buy: 0 when owned (as itself or its canonical item), when there are no prices, or when the
 * item has no price (untradeable). Looks up the id, then the canonical id, then for the name and each shorter name
 * (without a trailing "(…)") its versions and the name itself: a charged, imbued, corrupted or clan item is often only
 * tradeable as its plain or inactive version. An ornament copy without a price of its own costs what its base item costs,
 * and an untradeable item made from tradeable parts what its parts cost.
 */
export const itemPrice = (id: number, prices: Prices | null, owned: Set<number>): number => {
  const canonical = canonicalOf(id);
  if (!prices || owned.has(id) || owned.has(canonical)) return 0;
  const byId = prices.byId.get(id) ?? prices.byId.get(canonical);
  if (byId !== undefined) return byId;
  const name = itemById(id)?.name;
  if (!name) return 0;
  const base = baseName(id);
  for (const n of [...shorterNames(name), ...(base ? shorterNames(base) : [])]) {
    for (const other of versionIds(n)) {
      const price = prices.byId.get(other);
      if (price !== undefined) return price;
    }
    const price = prices.byName.get(n.toLowerCase());
    if (price !== undefined) return price;
  }
  const recipe = shorterNames(name).map((n) => RECIPES[n]).find(Boolean);
  return recipe ? recipe.reduce((n, part) => n + (prices.byId.get(part.itemId) ?? 0) * part.qty, 0) : 0;
};
