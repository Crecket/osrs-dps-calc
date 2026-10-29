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

/**
 * What the item costs to buy: 0 when owned (as itself or its canonical item), when there are no prices, or when the
 * item has no price (untradeable). Looks up the id, then the canonical id, then the name without a trailing "(…)".
 */
export const itemPrice = (id: number, prices: Prices | null, owned: Set<number>): number => {
  const canonical = getCanonicalItemId(id);
  if (!prices || owned.has(id) || owned.has(canonical)) return 0;
  const byId = prices.byId.get(id) ?? prices.byId.get(canonical);
  if (byId !== undefined) return byId;
  const name = itemById(id)?.name;
  if (!name) return 0;
  return prices.byName.get(name.toLowerCase()) ?? prices.byName.get(name.replace(/\s*\([^)]*\)$/, '').toLowerCase()) ?? 0;
};
