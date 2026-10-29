import { createContext, useContext } from 'react';
import localforage from 'localforage';
import { makeAutoObservable, toJS } from 'mobx';
import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import type { PresetStorage } from '@/bulk/state/BulkStore';
import { BEST_STYLES, BestStyle } from '@/best/types';
import {
  DEFENCE_WEAPONS, DefenceCounts, DefenceWeapon, MagicOption,
} from '@/raid/types';
import { RAIDS } from '@/raid/raids';
import { Supplies } from '@/raid/lib/layout';
import { parseInventorySetup } from '@/raid/lib/inventorySetups';
import {
  blockReason, defaultSettings, RaidResult, RaidSettings, requiredItems,
} from '@/raid/lib/runRaid';

export const RAID_STORAGE_KEY = 'dps-raid-state';
export const RAID_RESULT_KEY = 'dps-raid-result';

const MAGIC_OPTIONS: MagicOption[] = ['thralls', 'ancients', 'standard', 'none'];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

let itemIds: Set<number> | null = null;
const knownItemIds = () => {
  if (!itemIds) itemIds = new Set(availableEquipment.map((e) => e.id));
  return itemIds;
};
const readIds = (v: unknown) => (Array.isArray(v)
  ? [...new Set(v.filter((x): x is number => typeof x === 'number' && knownItemIds().has(x)))]
  : []);

/** Saved settings with defaults for anything missing or invalid */
const readSettings = (raw: unknown): RaidSettings => {
  const base = defaultSettings();
  const r = isRecord(raw) ? raw : {};
  const raidId = typeof r.raidId === 'string' && RAIDS.some((x) => x.id === r.raidId) ? r.raidId : base.raidId;
  const route = isRecord(r.route)
    ? Object.fromEntries(Object.entries(r.route).filter((e): e is [string, string] => typeof e[1] === 'string'))
    : base.route;
  const counts: RaidSettings['counts'] = {};
  if (isRecord(r.counts)) {
    Object.entries(r.counts).forEach(([key, c]) => {
      if (!isRecord(c)) return;
      const valid: Partial<DefenceCounts> = {};
      DEFENCE_WEAPONS.forEach((w) => {
        if (isCount(c[w])) valid[w] = c[w] as number;
      });
      counts[key] = valid;
    });
  }
  const s = isRecord(r.supplies) ? r.supplies : {};
  const supplies: Supplies = {
    brews: isCount(s.brews) ? s.brews : base.supplies.brews,
    restores: isCount(s.restores) ? s.restores : base.supplies.restores,
    reserved: isCount(s.reserved) ? s.reserved : base.supplies.reserved,
  };
  return {
    raidId,
    route,
    budget: typeof r.budget === 'number' && Number.isFinite(r.budget) && r.budget >= 0 ? r.budget : base.budget,
    ownedIds: readIds(r.ownedIds),
    excludedIds: readIds(r.excludedIds),
    counts,
    supplies,
    magic: MAGIC_OPTIONS.includes(r.magic as MagicOption) ? r.magic as MagicOption : base.magic,
    rulesOn: typeof r.rulesOn === 'boolean' ? r.rulesOn : base.rulesOn,
    styles: Array.isArray(r.styles) && BEST_STYLES.some((st) => (r.styles as unknown[]).includes(st))
      ? BEST_STYLES.filter((st) => (r.styles as unknown[]).includes(st))
      : base.styles,
  };
};

interface SavedResult {
  result: RaidResult;
  key: string;
}

export class RaidStore {
  settings: RaidSettings = defaultSettings();

  /** The last finished run and the settings key it was run with */
  result: RaidResult | null = null;

  resultKey: string | null = null;

  loaded = false;

  // set when saved settings couldn't be read, so we never overwrite them with defaults
  readFailed = false;

  private storage: PresetStorage;

  constructor(storage: PresetStorage = localforage) {
    this.storage = storage;
    makeAutoObservable<RaidStore, 'storage'>(this, { storage: false }, { autoBind: true });
  }

  async load() {
    let saved: unknown = null;
    let savedResult: SavedResult | null = null;
    let failed = false;
    try {
      saved = await this.storage.getItem(RAID_STORAGE_KEY);
    } catch (e) {
      console.warn('[RaidStore] Could not read saved settings', e);
      failed = true;
    }
    try {
      savedResult = await this.storage.getItem<SavedResult>(RAID_RESULT_KEY);
    } catch (e) {
      console.warn('[RaidStore] Could not read the last result', e);
    }
    this.apply(saved, savedResult, failed);
  }

  private apply(saved: unknown, savedResult: SavedResult | null, readFailed: boolean) {
    this.readFailed = readFailed;
    this.settings = readSettings(isRecord(saved) ? saved.settings : null);
    if (savedResult && isRecord(savedResult.result) && typeof savedResult.key === 'string') {
      this.result = savedResult.result;
      this.resultKey = savedResult.key;
    }
    this.loaded = true;
  }

  get canSave(): boolean {
    return this.loaded && !this.readFailed;
  }

  get blockReason(): string | null {
    return blockReason(this.settings);
  }

  get requiredIds(): number[] {
    return requiredItems(this.settings);
  }

  /** Changes whenever anything that affects the result changes */
  get runKey(): string {
    const s = toJS(this.settings);
    const sorted = (ids: number[]) => [...ids].sort((a, b) => a - b);
    return JSON.stringify({
      ...s,
      ownedIds: sorted(s.ownedIds),
      excludedIds: sorted(s.excludedIds),
      route: Object.entries(s.route).sort(),
      counts: Object.entries(s.counts).sort(),
    });
  }

  /** The shown result was run with other settings */
  get stale(): boolean {
    return this.result !== null && this.resultKey !== this.runKey;
  }

  setRoute(stopId: string, bossId: string) {
    this.settings.route = { ...this.settings.route, [stopId]: bossId };
    this.save();
  }

  setBudget(budget: number) {
    if (!Number.isFinite(budget) || budget < 0) return;
    this.settings.budget = budget;
    this.save();
  }

  setCount(phaseKey: string, weapon: DefenceWeapon, n: number) {
    if (!isCount(n)) return;
    this.settings.counts = { ...this.settings.counts, [phaseKey]: { ...this.settings.counts[phaseKey], [weapon]: n } };
    this.save();
  }

  setSupplies(s: Partial<Supplies>) {
    const next = { ...this.settings.supplies, ...s };
    if (![next.brews, next.restores, next.reserved].every(isCount)) return;
    this.settings.supplies = next;
    this.save();
  }

  setMagic(magic: MagicOption) {
    this.settings.magic = magic;
    this.save();
  }

  /** At least one style stays on: an empty list is ignored */
  setStyles(styles: BestStyle[]) {
    const ordered = BEST_STYLES.filter((st) => styles.includes(st));
    if (ordered.length === 0) return;
    this.settings.styles = ordered;
    this.save();
  }

  setRulesOn(on: boolean) {
    this.settings.rulesOn = on;
    this.save();
  }

  toggleOwned(id: number) {
    const canonical = getCanonicalItemId(id);
    const ids = this.settings.ownedIds;
    this.settings.ownedIds = ids.includes(canonical) ? ids.filter((x) => x !== canonical) : [...ids, canonical];
    this.save();
  }

  clearOwned() {
    this.settings.ownedIds = [];
    this.save();
  }

  exclude(id: number) {
    const canonical = getCanonicalItemId(id);
    if (this.settings.excludedIds.includes(canonical)) return;
    this.settings.excludedIds = [...this.settings.excludedIds, canonical];
    this.save();
  }

  include(id: number) {
    const canonical = getCanonicalItemId(id);
    this.settings.excludedIds = this.settings.excludedIds.filter((x) => x !== canonical);
    this.save();
  }

  /** Marks every item of an Inventory Setups export as owned; returns how many were new. Throws on other text. */
  importOwned(text: string): number {
    const ids = parseInventorySetup(text).filter((id) => knownItemIds().has(id)).map(getCanonicalItemId);
    const before = new Set(this.settings.ownedIds);
    const added = [...new Set(ids)].filter((id) => !before.has(id));
    this.settings.ownedIds = [...this.settings.ownedIds, ...added];
    this.save();
    return added.length;
  }

  setResult(result: RaidResult, key: string) {
    this.result = result;
    this.resultKey = key;
    this.flushResult().catch(console.error);
  }

  async flushResult() {
    if (!this.canSave || !this.result || !this.resultKey) return;
    try {
      await this.storage.setItem<SavedResult>(RAID_RESULT_KEY, { result: toJS(this.result), key: this.resultKey });
    } catch (e) {
      console.warn('[RaidStore] Could not save the result', e);
    }
  }

  private save() {
    if (!this.canSave) return;
    this.storage.setItem(RAID_STORAGE_KEY, { settings: toJS(this.settings) }).catch((e) => {
      console.error('[RaidStore] Could not save settings', e);
    });
  }
}

export const RaidStoreContext = createContext<RaidStore>(undefined as unknown as RaidStore);

export const useRaidStore = () => useContext(RaidStoreContext);
