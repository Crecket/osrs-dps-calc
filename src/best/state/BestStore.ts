import { createContext, useContext } from 'react';
import localforage from 'localforage';
import { makeAutoObservable, toJS } from 'mobx';
import Potion from '@/enums/Potion';
import { PlayerSkills } from '@/types/Player';
import { PotionMap } from '@/utils';
import {
  BEST_STYLES, BestInputs, BestStyle, CombatConditions, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS, PrayerUnlocks,
} from '@/best/types';
import { BulkMonster } from '@/bulk/types';
import type { PresetStorage } from '@/bulk/state/BulkStore';
import type { TargetHolder } from '@/bulk/state/TargetSync';

export const BEST_STORAGE_KEY = 'dps-best-state';

interface SavedBest {
  inputs: BestInputs;
  monster: BulkMonster | null;
}

const defaultInputs = (): BestInputs => ({
  skills: {
    atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
  },
  unlocks: { ...DEFAULT_UNLOCKS },
  conditions: { ...DEFAULT_CONDITIONS },
  potions: {},
  styles: [...BEST_STYLES],
  topN: 5,
});

const POTION_GROUPS = ['melee', 'ranged', 'magic'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Keeps the fields of `base` that `raw` has with the same type as the default; nothing else is copied */
const mergeTyped = <T extends object>(base: T, raw: unknown, valid: (k: keyof T, v: unknown) => boolean): T => {
  const out = { ...base };
  if (!isRecord(raw)) return out;
  for (const k of Object.keys(base) as (keyof T)[]) {
    if (k in raw && valid(k, raw[k as string])) out[k] = raw[k as string] as T[keyof T];
  }
  return out;
};

const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Saved state with defaults for anything missing or invalid, like readFilters does for bulk filters */
const readSaved = (raw: unknown): SavedBest => {
  const r = isRecord(raw) ? raw : {};
  const i = isRecord(r.inputs) ? r.inputs : {};
  const base = defaultInputs();

  const styles = Array.isArray(i.styles) ? BEST_STYLES.filter((s) => (i.styles as unknown[]).includes(s)) : [];
  const potions: BestInputs['potions'] = {};
  if (isRecord(i.potions)) {
    for (const g of POTION_GROUPS) {
      const p = i.potions[g];
      if (Array.isArray(p)) potions[g] = p.filter((x): x is Potion => typeof x === 'number' && x in PotionMap);
    }
  }

  const m = r.monster;
  const monster = isRecord(m) && isRecord(m.monster) && isNum(m.monster.id) && typeof m.monster.name === 'string'
    ? m as unknown as BulkMonster
    : null;

  return {
    inputs: {
      skills: mergeTyped(base.skills, i.skills, (_, v) => isNum(v)),
      unlocks: mergeTyped(base.unlocks, i.unlocks, (k, v) => (k === 'prayerLevel' ? isNum(v) : typeof v === 'boolean')),
      conditions: mergeTyped(base.conditions, i.conditions, (k, v) => {
        if (k === 'currentHp') return v === null || isNum(v);
        return k === 'soulreaperStacks' ? isNum(v) : typeof v === 'boolean';
      }),
      potions,
      styles: styles.length > 0 ? styles : base.styles,
      topN: typeof i.topN === 'number' && Number.isInteger(i.topN) && i.topN > 0 ? i.topN : base.topN,
    },
    monster,
  };
};

export class BestStore implements TargetHolder {
  inputs: BestInputs = defaultInputs();

  monster: BulkMonster | null = null;

  loaded = false;

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
    this.apply(saved, failed);
  }

  // an action, so the page's banner sees readFailed change together with loaded
  private apply(saved: unknown, readFailed: boolean) {
    this.readFailed = readFailed;
    const { inputs, monster } = readSaved(saved);
    this.inputs = inputs;
    this.monster = monster;
    this.loaded = true;
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

  /** Changes whenever anything that affects the result changes; null while there is nothing to run against */
  get runKey(): string | null {
    if (!this.monster) return null;
    const { potions, ...rest } = toJS(this.inputs);
    // fixed order for the potion groups, so the order they were set in doesn't matter
    const sortedPotions = POTION_GROUPS.map((g) => [g, potions[g] ?? null]);
    return JSON.stringify({ inputs: { ...rest, potions: sortedPotions }, monster: toJS(this.monster.monster) });
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
