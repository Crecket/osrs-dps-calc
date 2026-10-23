import { BulkPreset, BulkRow } from '@/bulk/types';
import { setupKey } from '@/bulk/lib/dedupe';

export type Mode = 'normal' | 'spec';

export type SortKey = 'maxHit' | 'accuracy' | 'dps' | 'ttk' | 'specMaxHit' | 'specAccuracy' | 'specExpected' | 'specDps' | 'specRegenDps';

export interface SortState {
  key: SortKey;
  dir: 'asc' | 'desc';
}

export const NORMAL_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'maxHit', label: 'Max hit' },
  { key: 'accuracy', label: 'Accuracy' },
  { key: 'dps', label: 'DPS' },
  { key: 'ttk', label: 'TTK' },
];

export const SPEC_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'specMaxHit', label: 'Spec max' },
  { key: 'specAccuracy', label: 'Spec acc' },
  { key: 'specExpected', label: 'Spec dmg' },
  { key: 'specDps', label: 'Spec DPS' },
  { key: 'specRegenDps', label: 'Spec-only DPS' },
];

export const defaultSort = (mode: Mode): SortState => (mode === 'spec'
  ? { key: 'specExpected', dir: 'desc' }
  : { key: 'dps', dir: 'desc' });

// lower is better for time-to-kill, so it starts ascending
export const firstClickDir = (key: SortKey): SortState['dir'] => (key === 'ttk' ? 'asc' : 'desc');

export const sortValue = (r: BulkRow, key: SortKey): number | null => {
  switch (key) {
    case 'maxHit': return r.maxHit;
    case 'accuracy': return r.accuracy;
    case 'dps': return r.dps;
    case 'ttk': return r.ttk;
    case 'specMaxHit': return r.spec?.maxHit ?? null;
    case 'specAccuracy': return r.spec?.accuracy ?? null;
    case 'specExpected': return r.spec?.expected ?? null;
    case 'specDps': return r.spec?.dps ?? null;
    case 'specRegenDps': return r.spec?.regenDps ?? null;
    default: return null;
  }
};

export const selectRows = (
  rows: BulkRow[],
  opts: { mode: Mode; sort: SortState },
): BulkRow[] => {
  const { mode, sort } = opts;
  const sign = sort.dir === 'asc' ? 1 : -1;

  return rows
    .map((r, i) => ({ r, i }))
    // spec mode keeps error rows, so a failed calc is never silently hidden
    .filter(({ r }) => mode !== 'spec' || r.spec !== null || !!r.error)
    .sort((a, b) => {
      // errors, then missing values, always go to the bottom regardless of direction
      const ea = a.r.error ? 1 : 0;
      const eb = b.r.error ? 1 : 0;
      if (ea !== eb) return ea - eb;

      const va = sortValue(a.r, sort.key);
      const vb = sortValue(b.r, sort.key);
      if (va === null || vb === null) {
        if (va === vb) return a.i - b.i;
        return va === null ? 1 : -1;
      }

      return (va - vb) * sign || a.i - b.i;
    })
    .map(({ r }) => r);
};

/**
 * Identifies what a run would compute: changes when the target, the list of setups, or anything about them that the
 * calculation reads changes (not a rename), and is null when there is nothing to run.
 */
export const runKey = (preset: BulkPreset | null): string | null => {
  if (!preset?.monster || preset.setups.length === 0) return null;
  return JSON.stringify([
    preset.id,
    preset.monster.id,
    preset.monster.monster,
    preset.setups.map((s) => [s.id, setupKey(s.player)]),
  ]);
};
