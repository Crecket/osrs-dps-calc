import { createContext, useContext } from 'react';
import localforage from 'localforage';
import { makeAutoObservable, toJS } from 'mobx';
import { BUILD_ID } from '@/lib/build';
import Potion from '@/enums/Potion';
import { Prayer } from '@/enums/Prayer';
import { PlayerSkills } from '@/types/Player';
import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import {
  BEST_STYLES, BestInputs, BestStyle, CombatConditions, PrayerUnlocks,
} from '@/best/types';
import { PRAYER_GROUPS, PrayerGroup } from '@/best/lib/loadout';
import { defaultAccount, readAccount } from '@/best/lib/account';
import { BulkMonster } from '@/bulk/types';
import type { PresetStorage } from '@/bulk/state/BulkStore';
import type { TargetHolder } from '@/bulk/state/TargetSync';
import type { StyleOutcome } from '@/best/lib/run';

export const BEST_STORAGE_KEY = 'dps-best-state';
export const BEST_RESULT_KEY = 'dps-best-result';

export interface BestSavedResult {
  outcomes: StyleOutcome[];
  /** The runKey it was searched with */
  key: string;
  build?: string;
}

interface SavedBest {
  inputs: BestInputs;
  monster: BulkMonster | null;
}

const defaultInputs = (): BestInputs => ({
  ...defaultAccount(),
  styles: [...BEST_STYLES],
  topN: 5,
  excludedItemIds: [],
});

const POTION_GROUPS = ['melee', 'ranged', 'magic'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

let itemIds: Set<number> | null = null;
const knownItemIds = () => {
  if (!itemIds) itemIds = new Set(availableEquipment.map((e) => e.id));
  return itemIds;
};

/** Saved state with defaults for anything missing or invalid, like readFilters does for bulk filters */
const readSaved = (raw: unknown): SavedBest => {
  const r = isRecord(raw) ? raw : {};
  const i = isRecord(r.inputs) ? r.inputs : {};
  const base = defaultInputs();

  const styles = Array.isArray(i.styles) ? BEST_STYLES.filter((s) => (i.styles as unknown[]).includes(s)) : [];
  const excludedItemIds = Array.isArray(i.excludedItemIds)
    ? [...new Set((i.excludedItemIds as unknown[]).filter((x): x is number => isNum(x) && knownItemIds().has(x as number)))]
    : [];

  const m = r.monster;
  const monster = isRecord(m) && isRecord(m.monster) && isNum(m.monster.id) && typeof m.monster.name === 'string'
    ? m as unknown as BulkMonster
    : null;

  return {
    inputs: {
      ...readAccount(i),
      styles: styles.length > 0 ? styles : base.styles,
      topN: typeof i.topN === 'number' && Number.isInteger(i.topN) && i.topN > 0 ? i.topN : base.topN,
      excludedItemIds,
    },
    monster,
  };
};

export class BestStore implements TargetHolder {
  inputs: BestInputs = defaultInputs();

  monster: BulkMonster | null = null;

  loaded = false;

  /** The last finished search, from the last visit too, while it's from this build */
  lastResult: BestSavedResult | null = null;

  private storage: PresetStorage;

  // set when saved state couldn't be read, so we never overwrite it with defaults; the page warns about it
  readFailed = false;

  constructor(storage: PresetStorage = localforage) {
    this.storage = storage;
    makeAutoObservable<BestStore, 'storage'>(this, { storage: false }, { autoBind: true });
  }

  async load() {
    let saved: SavedBest | null = null;
    let failed = false;
    try {
      saved = await this.storage.getItem<SavedBest>(BEST_STORAGE_KEY);
    } catch (e) {
      console.warn('[BestStore] Could not read saved state', e);
      failed = true;
    }
    let savedResult: BestSavedResult | null = null;
    try {
      savedResult = await this.storage.getItem<BestSavedResult>(BEST_RESULT_KEY);
    } catch (e) {
      console.warn('[BestStore] Could not read the last result', e);
    }
    this.apply(saved, failed, savedResult);
  }

  // an action, so the page's banner sees readFailed change together with loaded
  private apply(saved: unknown, readFailed: boolean, savedResult: BestSavedResult | null = null) {
    this.readFailed = readFailed;
    const { inputs, monster } = readSaved(saved);
    this.inputs = inputs;
    this.monster = monster;
    // from another build the search or the engine may have changed; deleted, not just ignored, so it doesn't sit in storage
    if (savedResult && Array.isArray(savedResult.outcomes) && typeof savedResult.key === 'string' && savedResult.build === BUILD_ID) {
      this.lastResult = savedResult;
    } else if (savedResult) {
      this.storage.removeItem?.(BEST_RESULT_KEY).catch((e) => console.warn('[BestStore] Could not delete an old result', e));
    }
    this.loaded = true;
  }

  async setResult(outcomes: StyleOutcome[], key: string) {
    this.lastResult = { outcomes, key, build: BUILD_ID };
    if (!this.canSave) return;
    try {
      await this.storage.setItem<BestSavedResult>(BEST_RESULT_KEY, toJS(this.lastResult));
    } catch (e) {
      console.warn('[BestStore] Could not save the result', e);
    }
  }

  // TargetHolder: there is a single target; it can be set once saved state has been read and is safe to overwrite
  readonly targetScope = 'best';

  get canSave(): boolean {
    return this.loaded && !this.readFailed;
  }

  get target(): BulkMonster | null {
    return this.monster;
  }

  setTarget(m: BulkMonster) {
    // before load the saved monster hasn't been read yet, and load would discard this one anyway
    if (!this.canSave) return;
    this.monster = m;
    this.save();
  }

  setSkills(s: Partial<PlayerSkills>) {
    this.inputs.skills = { ...this.inputs.skills, ...s };
    this.save();
  }

  setUnlocks(u: Partial<PrayerUnlocks>) {
    this.inputs.unlocks = { ...this.inputs.unlocks, ...u };
    this.save();
  }

  setConditions(c: Partial<CombatConditions>) {
    this.inputs.conditions = { ...this.inputs.conditions, ...c };
    this.save();
  }

  setStyles(s: BestStyle[]) {
    this.inputs.styles = [...s];
    this.save();
  }

  /** null removes the override, so the group goes back to its default potion */
  setPotions(group: 'melee' | 'ranged' | 'magic', p: Potion[] | null) {
    const potions = { ...this.inputs.potions };
    if (p === null) delete potions[group];
    else potions[group] = [...p];
    this.inputs.potions = potions;
    this.save();
  }

  /** null removes the override, so the group goes back to Auto (the best usable prayers); [] is no prayer */
  setPrayerOverride(group: PrayerGroup, prayers: Prayer[] | null) {
    const overrides = { ...this.inputs.prayerOverrides };
    if (prayers === null) delete overrides[group];
    else overrides[group] = [...prayers];
    this.inputs.prayerOverrides = overrides;
    this.save();
  }

  /** Leaves the item (as its canonical item) out of the search */
  excludeItem(id: number) {
    const canonical = getCanonicalItemId(id);
    const ids = this.inputs.excludedItemIds ?? [];
    if (ids.includes(canonical)) return;
    this.inputs.excludedItemIds = [...ids, canonical];
    this.save();
  }

  includeItem(id: number) {
    const canonical = getCanonicalItemId(id);
    this.inputs.excludedItemIds = (this.inputs.excludedItemIds ?? []).filter((x) => x !== canonical);
    this.save();
  }

  clearExcluded() {
    this.inputs.excludedItemIds = [];
    this.save();
  }

  /** Changes whenever anything that affects the result changes; null while there is nothing to run against */
  get runKey(): string | null {
    if (!this.monster) return null;
    const {
      potions, prayerOverrides = {}, excludedItemIds = [], ...rest
    } = toJS(this.inputs);
    // fixed order for the potion and prayer groups, so the order they were set in doesn't matter
    const sortedPotions = POTION_GROUPS.map((g) => [g, potions[g] ?? null]);
    const sortedPrayers = PRAYER_GROUPS.map((g) => [g, prayerOverrides[g] ?? null]);
    const inputs = {
      ...rest, potions: sortedPotions, prayerOverrides: sortedPrayers, excludedItemIds: [...excludedItemIds].sort((a, b) => a - b),
    };
    return JSON.stringify({ inputs, monster: toJS(this.monster.monster) });
  }

  private save() {
    if (!this.canSave) return;
    const data: SavedBest = { inputs: toJS(this.inputs), monster: toJS(this.monster) };
    this.storage.setItem(BEST_STORAGE_KEY, data).catch((e) => {
      console.error('[BestStore] Could not save state', e);
    });
  }
}

export const BestStoreContext = createContext<BestStore>(undefined as unknown as BestStore);

export const useBestStore = () => useContext(BestStoreContext);
