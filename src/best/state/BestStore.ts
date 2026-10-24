import { createContext, useContext } from 'react';
import localforage from 'localforage';
import { makeAutoObservable, toJS } from 'mobx';
import Potion from '@/enums/Potion';
import { PlayerSkills } from '@/types/Player';
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

export class BestStore implements TargetHolder {
  inputs: BestInputs = defaultInputs();

  monster: BulkMonster | null = null;

  loaded = false;

  // TargetHolder: there is a single target and it can always be set
  readonly targetScope = 'best';

  readonly canSave = true;

  private storage: PresetStorage;

  // set when saved state couldn't be read, so we never overwrite it with defaults
  private readFailed = false;

  constructor(storage: PresetStorage = localforage) {
    this.storage = storage;
    makeAutoObservable<BestStore, 'storage' | 'readFailed'>(this, { storage: false, readFailed: false }, { autoBind: true });
  }

  async load() {
    let saved: SavedBest | null = null;
    try {
      saved = await this.storage.getItem<SavedBest>(BEST_STORAGE_KEY);
    } catch (e) {
      console.warn('[BestStore] Could not read saved state', e);
      this.readFailed = true;
    }
    this.apply(saved);
  }

  private apply(saved: SavedBest | null) {
    const base = defaultInputs();
    const s = saved?.inputs;
    // merge over the defaults so inputs added in a later version still get a value
    this.inputs = {
      ...base,
      ...s,
      skills: { ...base.skills, ...s?.skills },
      unlocks: { ...base.unlocks, ...s?.unlocks },
      conditions: { ...base.conditions, ...s?.conditions },
      potions: { ...s?.potions },
    };
    this.monster = saved?.monster ?? null;
    this.loaded = true;
  }

  get target(): BulkMonster | null {
    return this.monster;
  }

  setTarget(m: BulkMonster) {
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
    return JSON.stringify({ inputs: toJS(this.inputs), monster: toJS(this.monster.monster) });
  }

  private save() {
    if (this.readFailed) return;
    const data: SavedBest = { inputs: toJS(this.inputs), monster: toJS(this.monster) };
    this.storage.setItem(BEST_STORAGE_KEY, data).catch((e) => {
      console.error('[BestStore] Could not save state', e);
    });
  }
}

export const BestStoreContext = createContext<BestStore>(undefined as unknown as BestStore);

export const useBestStore = () => useContext(BestStoreContext);
