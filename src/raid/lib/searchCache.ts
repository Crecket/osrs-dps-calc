import localforage from 'localforage';
import { availableEquipment } from '@/lib/Equipment';
import { getMonsters } from '@/lib/Monsters';
import { EquipmentPiece, Player } from '@/types/Player';
import { BestStyle } from '@/best/types';
import { Gear } from '@/best/lib/search';
import { bestPool, WeaponJob } from '@/best/lib/candidates';
import { hashKey } from '@/best/lib/resultCache';
import { ENGINE_ID } from '@/lib/build';
import type { PresetStorage } from '@/bulk/state/BulkStore';

export const SEARCH_CACHE_KEY = 'dps-raid-searches';
// bump when the search or the stored form changes, so old results aren't reused
const CACHE_VERSION = 5;

/**
 * Everything of a player that changes its damage, besides its gear: levels, boosts, prayers, buffs, style, spell, and
 * anything added to Player later. The rest is the setup's name or follows from the gear.
 */
export const playerStatsKey = ({
  uuid, name, equipment, attackSpeed, bonuses, offensive, defensive, ...stats
}: Player) => JSON.stringify(stats);

/** A search result small enough to keep: the setup as ids, rebuilt into a player when used */
export interface StoredCandidate {
  style: BestStyle;
  job: WeaponJob;
  gear: Gear;
  dps: number;
}

interface Saved {
  version: string;
  entries: [string, StoredCandidate[]][];
  /** Expected spec damage by spec setup key */
  specs?: [string, number][];
}

// spec damage and the loadout upgrade's DPS lookups
const SPEC_LIMIT = 30000;

// how long after a write it waits for more writes, and at most: a planner writing all the time must still get saved
const SAVE_DELAY = 1000;
const MAX_SAVE_DELAY = 10000;

/**
 * A data update (new items or monsters) can change any result, and so can a change to the items the search may use
 * (e.g. Leagues items left out): results holding an item no longer allowed must not come back. So can a change to the
 * search or the DPS engine the spec and upgrade DPS lookups come from, so a build with either starts empty; any other
 * deploy keeps the cache.
 */
export const cacheVersion = (pool: EquipmentPiece[], build: string = ENGINE_ID) => `${CACHE_VERSION}:${build}:${availableEquipment.length}:${getMonsters().length}:${hashKey(pool.map((e) => e.id).join(','))}`;

let version: string | null = null;
const currentVersion = () => {
  if (!version) version = cacheVersion(bestPool());
  return version;
};

/**
 * Finished raid searches by key, kept across page loads in least-recently-used order. Writes are debounced; a failed
 * read starts empty.
 */
export class SearchCache {
  private entries = new Map<string, StoredCandidate[]>();

  private specs = new Map<string, number>();

  private timer: ReturnType<typeof setTimeout> | null = null;

  // when the oldest unsaved write was made; null when all are saved
  private dirtySince: number | null = null;

  constructor(private storage: PresetStorage = localforage, private limit = 300) {}

  async load() {
    try {
      const saved = await this.storage.getItem<Saved>(SEARCH_CACHE_KEY);
      if (saved && saved.version === currentVersion() && Array.isArray(saved.entries)) {
        this.entries = new Map(saved.entries);
        if (Array.isArray(saved.specs)) this.specs = new Map(saved.specs);
      } else if (saved) {
        // searches from older data or an older search: deleted, so they don't sit in storage until the next save
        await this.storage.removeItem?.(SEARCH_CACHE_KEY);
      }
    } catch (e) {
      console.warn('[raid] Could not read cached searches', e);
    }
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  /** Like get, without counting as a use */
  peek(key: string): StoredCandidate[] | undefined {
    return this.entries.get(key);
  }

  get(key: string): StoredCandidate[] | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      // most recently used goes last
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  getSpec(key: string): number | undefined {
    return this.specs.get(key);
  }

  setSpec(key: string, expected: number) {
    this.specs.delete(key);
    this.specs.set(key, expected);
    while (this.specs.size > SPEC_LIMIT) this.specs.delete(this.specs.keys().next().value!);
    this.scheduleSave();
  }

  set(key: string, value: StoredCandidate[]) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    this.scheduleSave();
  }

  private scheduleSave() {
    if (this.timer) clearTimeout(this.timer);
    const now = Date.now();
    this.dirtySince ??= now;
    this.timer = setTimeout(() => {
      this.flush().catch(console.error);
    }, Math.min(SAVE_DELAY, Math.max(0, this.dirtySince + MAX_SAVE_DELAY - now)));
  }

  /** Saves any unsaved writes now */
  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.dirtySince === null) return;
    this.dirtySince = null;
    const data: Saved = { version: currentVersion(), entries: [...this.entries], specs: [...this.specs] };
    try {
      await this.storage.setItem(SEARCH_CACHE_KEY, data);
    } catch (e) {
      console.warn('[raid] Could not save cached searches', e);
    }
  }
}
