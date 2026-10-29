import localforage from 'localforage';
import { availableEquipment } from '@/lib/Equipment';
import { getMonsters } from '@/lib/Monsters';
import { BestStyle } from '@/best/types';
import { Gear } from '@/best/lib/search';
import { WeaponJob } from '@/best/lib/candidates';
import type { PresetStorage } from '@/bulk/state/BulkStore';

export const SEARCH_CACHE_KEY = 'dps-raid-searches';
// bump when the search or the stored form changes, so old results aren't reused
const CACHE_VERSION = 2;

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
}

// a data update (new items or monsters) can change any result
const currentVersion = () => `${CACHE_VERSION}:${availableEquipment.length}:${getMonsters().length}`;

/**
 * Finished raid searches by key, kept across page loads in least-recently-used order. Writes are debounced; a failed
 * read starts empty.
 */
export class SearchCache {
  private entries = new Map<string, StoredCandidate[]>();

  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private storage: PresetStorage = localforage, private limit = 300) {}

  async load() {
    try {
      const saved = await this.storage.getItem<Saved>(SEARCH_CACHE_KEY);
      if (saved && saved.version === currentVersion() && Array.isArray(saved.entries)) {
        this.entries = new Map(saved.entries);
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

  set(key: string, value: StoredCandidate[]) {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.flush().catch(console.error);
    }, 1000);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const data: Saved = { version: currentVersion(), entries: [...this.entries] };
    try {
      await this.storage.setItem(SEARCH_CACHE_KEY, data);
    } catch (e) {
      console.warn('[raid] Could not save cached searches', e);
    }
  }
}
