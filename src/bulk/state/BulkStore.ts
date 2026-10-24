import { createContext, useContext } from 'react';
import localforage from 'localforage';
import { makeAutoObservable, toJS } from 'mobx';
import { IMPORT_VERSION } from '@/types/State';
import { Player } from '@/types/Player';
import { generateEmptyPlayer } from '@/state';
import { loadPreset, newId } from '@/bulk/lib/presetIO';
import { uniqueNewSetups } from '@/bulk/lib/dedupe';
import { defaultSetups } from '@/bulk/lib/defaultSetups';
import { hasGear } from '@/bulk/lib/calculatorLoadouts';
import type { TargetHolder } from '@/bulk/state/TargetSync';
import { DEFAULT_FILTERS } from '@/bulk/lib/filters';
import {
  BulkFilters, BulkMonster, BulkPreset, BulkSetup, LegacyBulkPreset,
} from '@/bulk/types';

export const STORAGE_KEY = 'dps-bulk-presets';

export interface PresetStorage {
  getItem<T>(key: string): Promise<T | null>;
  setItem<T>(key: string, value: T): Promise<T>;
}

interface SavedPresets {
  presets: (BulkPreset | LegacyBulkPreset)[];
  activeId: string | null;
}

export class BulkStore implements TargetHolder {
  presets: BulkPreset[] = [];

  activeId: string | null = null;

  loaded = false;

  warnings: string[] = [];

  private storage: PresetStorage;

  // set when saved presets couldn't be read, so we never overwrite them with an empty list
  private readFailed = false;

  // the latest save: true once it is written, false if it failed or saving is off
  private lastSave: Promise<boolean> = Promise.resolve(true);

  constructor(storage: PresetStorage = localforage) {
    this.storage = storage;
    makeAutoObservable<BulkStore, 'storage' | 'readFailed' | 'lastSave'>(
      this,
      { storage: false, readFailed: false, lastSave: false },
      { autoBind: true },
    );
  }

  get active(): BulkPreset | null {
    return this.presets.find((p) => p.id === this.activeId) || null;
  }

  // TargetHolder: the active preset's monster is the target
  get targetScope(): string | null {
    return this.activeId;
  }

  get target(): BulkMonster | null {
    return this.active?.monster ?? null;
  }

  get canSave(): boolean {
    return !!this.active;
  }

  /** False when saved presets couldn't be read, so changes are kept in memory only. A method: readFailed isn't observable. */
  persists(): boolean {
    return !this.readFailed;
  }

  /** Resolves when the latest change has been written: true, or false if it couldn't be. */
  whenSaved(): Promise<boolean> {
    return this.lastSave;
  }

  setTarget(m: BulkMonster) {
    this.setMonster(m);
  }

  get canRun(): { ok: boolean; reason?: string } {
    if (!this.active || this.active.setups.length === 0) return { ok: false, reason: 'Add at least one setup' };
    if (!this.active.monster) return { ok: false, reason: 'Pick a monster' };
    return { ok: true };
  }

  async load() {
    let saved: SavedPresets | null = null;
    const warnings: string[] = [];
    try {
      saved = await this.storage.getItem<SavedPresets>(STORAGE_KEY);
    } catch (e) {
      console.warn('[BulkStore] Could not read saved presets', e);
      this.readFailed = true;
      warnings.push('Saved presets could not be read, so changes in this tab will not be saved. Try reloading the page.');
    }

    const presets = (saved?.presets || []).map((raw) => {
      try {
        const { preset, warnings: w } = loadPreset(raw);
        warnings.push(...w.map((msg) => `${preset.name}: ${msg}`));
        return preset;
      } catch (e) {
        // keep the preset as stored rather than losing it; it may load after a fix
        const name = raw?.name || 'Unnamed preset';
        warnings.push(`${name}: could not be loaded (${e instanceof Error ? e.message : String(e)})`);
        return {
          ...raw, name, setups: raw?.setups || [], monster: (raw as BulkPreset)?.monster ?? null,
        } as BulkPreset;
      }
    });

    this.setLoaded(presets, saved?.activeId || null, warnings);
  }

  private setLoaded(presets: BulkPreset[], activeId: string | null, warnings: string[]) {
    this.presets = presets;
    this.activeId = presets.some((p) => p.id === activeId) ? activeId : presets[0]?.id || null;
    this.warnings = [...new Set(warnings)];
    this.loaded = true;
    if (this.presets.length === 0) this.createPreset('My preset');
  }

  createPreset(name: string): BulkPreset {
    const now = Date.now();
    const preset: BulkPreset = {
      id: newId(),
      name,
      createdAt: now,
      updatedAt: now,
      serializationVersion: IMPORT_VERSION,
      setups: [],
      monster: null,
    };
    const defaults = defaultSetups();
    preset.setups = defaults.setups;
    if (defaults.warnings.length > 0) this.warnings = [...new Set([...this.warnings, ...defaults.warnings])];
    this.presets.push(preset);
    this.activeId = preset.id;
    this.save();
    return preset;
  }

  importPreset(raw: BulkPreset | LegacyBulkPreset) {
    const { preset, warnings } = loadPreset(raw);
    this.presets.push(preset);
    this.activeId = preset.id;
    this.warnings = [...new Set(warnings.map((msg) => `${preset.name}: ${msg}`))];
    this.save();
  }

  renamePreset(id: string, name: string) {
    const p = this.presets.find((x) => x.id === id);
    if (!p) return;
    p.name = name;
    this.touch(p);
  }

  deletePreset(id: string) {
    this.presets = this.presets.filter((p) => p.id !== id);
    if (this.activeId === id) this.activeId = this.presets[0]?.id || null;
    if (this.presets.length === 0) {
      this.createPreset('My preset');
      return;
    }
    this.save();
  }

  setActive(id: string) {
    this.activeId = id;
    this.save();
  }

  dismissWarnings() {
    this.warnings = [];
  }

  /**
   * Adds the setups that aren't already in the active preset.
   */
  addSetups(setups: BulkSetup[]): { added: number; skipped: number } {
    if (!this.active) return { added: 0, skipped: setups.length };
    const fresh = uniqueNewSetups(setups, this.active.setups);
    if (fresh.length > 0) {
      this.active.setups.push(...fresh);
      this.touch(this.active);
    }
    return { added: fresh.length, skipped: setups.length - fresh.length };
  }

  addDefaultSetups(): { added: number; skipped: number } {
    return this.addSetups(defaultSetups().setups);
  }

  removeSetup(id: string) {
    if (!this.active) return;
    this.active.setups = this.active.setups.filter((s) => s.id !== id);
    this.touch(this.active);
  }

  /**
   * Adds a blank setup to build in the setup editor. Unlike addSetups, this skips the duplicate check: two blank setups
   * are two setups still being built.
   */
  createSetup(): BulkSetup {
    const names = new Set(this.active?.setups.map((s) => s.name));
    let name = 'New setup';
    for (let n = 2; names.has(name); n += 1) name = `New setup ${n}`;
    const setup: BulkSetup = { id: newId(), name, player: generateEmptyPlayer(name) };
    if (this.active) {
      this.active.setups.push(setup);
      this.touch(this.active);
    }
    return setup;
  }

  /**
   * Inserts a copy of a setup right after it, to change from there (so the duplicate check doesn't apply).
   */
  copySetup(id: string): BulkSetup | null {
    const setups = this.active?.setups;
    const ix = setups?.findIndex((x) => x.id === id) ?? -1;
    if (!setups || ix < 0 || !this.active) return null;
    const name = `${setups[ix].name} (copy)`;
    const copy: BulkSetup = { id: newId(), name, player: { ...toJS(setups[ix].player), name } };
    setups.splice(ix + 1, 0, copy);
    this.touch(this.active);
    return setups[ix + 1];
  }

  /**
   * Removes a setup if nothing has been equipped on it yet (a new setup that was opened and closed again).
   */
  discardIfBlank(id: string): boolean {
    const s = this.active?.setups.find((x) => x.id === id);
    if (!s || hasGear(s.player)) return false;
    this.removeSetup(id);
    return true;
  }

  updateSetupPlayer(id: string, player: Player) {
    const s = this.active?.setups.find((x) => x.id === id);
    if (!s || !this.active) return;
    s.player = player;
    this.touch(this.active);
  }

  renameSetup(id: string, name: string) {
    const s = this.active?.setups.find((x) => x.id === id);
    if (!s || !this.active) return;
    s.name = name;
    this.touch(this.active);
  }

  get filters(): BulkFilters {
    return this.active?.filters ?? DEFAULT_FILTERS;
  }

  setFilters(patch: Partial<BulkFilters>) {
    if (!this.active) return;
    this.active.filters = { ...toJS(this.filters), ...patch };
    this.touch(this.active);
  }

  setMonster(m: BulkMonster | null) {
    if (!this.active) return;
    this.active.monster = m;
    this.touch(this.active);
  }

  private touch(p: BulkPreset) {
    p.updatedAt = Date.now();
    this.save();
  }

  private save() {
    if (this.readFailed) {
      this.lastSave = Promise.resolve(false);
      return;
    }
    // toJS only converts observables, so convert the observable fields rather than a plain wrapper object
    const data: SavedPresets = { presets: toJS(this.presets), activeId: this.activeId };
    this.lastSave = this.storage.setItem(STORAGE_KEY, data).then(() => true, (e) => {
      console.error('[BulkStore] Could not save presets', e);
      return false;
    });
  }
}

export const BulkStoreContext = createContext<BulkStore>(undefined as unknown as BulkStore);

export const useBulkStore = () => useContext(BulkStoreContext);
