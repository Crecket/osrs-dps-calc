import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  IconAlertTriangle, IconChevronDown, IconChevronUp, IconX,
} from '@tabler/icons-react';
import GearCells from '@/bulk/components/GearCells';
import BuffIcons from '@/bulk/components/BuffIcons';
import {
  firstClickDir, Mode, NORMAL_COLUMNS, SortKey, SortState, SPEC_COLUMNS,
} from '@/bulk/lib/table';
import { BulkFilters, BulkRow, BulkSetup } from '@/bulk/types';
import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { overriddenSlots } from '@/bulk/lib/filters';
import StyleLabel from '@/bulk/components/StyleLabel';

const formatValue = (r: BulkRow, key: SortKey): string => {
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  switch (key) {
    case 'maxHit': return r.maxHit.toString();
    case 'accuracy': return pct(r.accuracy);
    case 'dps': return r.dps.toFixed(3);
    case 'ttk': return r.ttk === null ? '—' : `${r.ttk.toFixed(1)}s`;
    case 'specMaxHit': return r.spec ? r.spec.maxHit.toString() : '—';
    case 'specAccuracy': return r.spec ? pct(r.spec.accuracy) : '—';
    case 'specExpected': return r.spec ? r.spec.expected.toFixed(2) : '—';
    case 'specDps': return r.spec ? r.spec.dps.toFixed(3) : '—';
    case 'specRegenDps': return r.spec ? r.spec.regenDps.toFixed(3) : '—';
    default: return '';
  }
};

interface BulkTableProps {
  rows: BulkRow[];
  setups: BulkSetup[];
  mode: Mode;
  sort: SortState;
  onSort: (s: SortState) => void;
  // whether a run has finished, so empty results can be explained correctly
  hasRun: boolean;
  // slot overrides, marked in the gear of every row
  overrides?: BulkFilters['overrides'];
  // why each filtered-out row is filtered; those rows are greyed out and not ranked
  filtered?: Map<string, string>;
  // rows showing the previous run's numbers while they're recalculated
  stale?: Set<string>;
  // an extra last cell per row, e.g. a button acting on that setup
  rowAction?: (setupId: string) => React.ReactNode;
  /** A right-click on a worn item in a row's gear cells */
  onItemContextMenu?: (slot: keyof PlayerEquipment, item: EquipmentPiece) => void;
}

// observer, so renaming a setup re-renders rows without the parent having to
const BulkTable: React.FC<BulkTableProps> = observer(({
  rows, setups, mode, sort, onSort, hasRun, overrides = {}, filtered = new Map(), stale = new Set(), rowAction, onItemContextMenu,
}) => {
  // not memoized: preset arrays are mutated in place, so their identity can't be used as a dependency
  const setupsById = new Map(setups.map((s) => [s.id, s]));
  const columns = mode === 'spec' ? SPEC_COLUMNS : NORMAL_COLUMNS;
  let rank = 0;

  const clickHeader = (key: SortKey) => {
    if (sort.key === key) {
      onSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSort({ key, dir: firstClickDir(key) });
    }
  };

  if (rows.length === 0) {
    return (
      <p className="px-4 py-6 text-sm text-center text-gray-500 dark:text-gray-300">
        {filtered.size > 0 && 'All results are filtered out.'}
        {filtered.size === 0 && (hasRun && mode === 'spec'
          ? 'No setups in this preset have a supported special attack.'
          : 'No results yet.')}
      </p>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="bg-btns-400 dark:bg-dark-500 text-white font-serif text-left">
          <th className="px-2 py-1.5 w-10 text-center">#</th>
          <th className="px-2 py-1.5">Setup</th>
          <th className="px-2 py-1.5">Gear</th>
          <th className="px-2 py-1.5">Buffs</th>
          {columns.map((c) => (
            <th key={c.key} className="px-2 py-1.5 text-right whitespace-nowrap">
              <button type="button" className="inline-flex items-center gap-0.5 hover:text-orange-200" onClick={() => clickHeader(c.key)}>
                {c.label}
                {sort.key === c.key && (sort.dir === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
              </button>
            </th>
          ))}
          <th className="px-2 py-1.5 w-8" aria-label="Warnings" />
          {rowAction && <th className="px-2 py-1.5" aria-label="Actions" />}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const setup = setupsById.get(r.setupId);
          if (!setup) return null;
          const reason = filtered.get(r.setupId);
          const isStale = stale.has(r.setupId);
          if (!reason) rank += 1;

          const warnings = [...r.issues];
          if (r.spec?.partial) warnings.push('Spec only partially supported');

          return (
            <tr
              key={r.setupId}
              className={`border-b border-body-200 dark:border-dark-400 odd:bg-body-100/40 dark:odd:bg-dark-400/40 ${reason ? 'opacity-40' : ''}`}
            >
              <td className="px-2 py-1 text-center text-gray-500 dark:text-gray-300">{reason ? '—' : rank}</td>
              <td className="px-2 py-1 whitespace-nowrap">
                <span className="font-semibold">{setup.name}</span>
                <StyleLabel player={setup.player} className="ml-1 align-middle" />
                {reason && <span className="ml-2 text-xs italic">{reason}</span>}
              </td>
              <td className="px-2 py-1" aria-label="Gear"><GearCells player={setup.player} marked={overriddenSlots(setup.player, overrides)} onItemContextMenu={onItemContextMenu} /></td>
              <td className="px-2 py-1 whitespace-nowrap" aria-label="Prayers and potions"><BuffIcons player={setup.player} /></td>
              {r.error ? (
                <td colSpan={columns.length} className="px-2 py-1 text-right text-red-400">
                  <span className="inline-flex items-center gap-1">
                    <IconX size={16} />
                    {r.error}
                  </span>
                </td>
              ) : columns.map((c) => (
                <td
                  key={c.key}
                  className={`px-2 py-1 text-right tabular-nums ${sort.key === c.key ? 'font-bold' : ''} ${isStale ? 'text-gray-400 italic' : ''}`}
                  title={isStale ? 'Recalculating' : undefined}
                >
                  {formatValue(r, c.key)}
                </td>
              ))}
              <td className="px-2 py-1 text-center" aria-label={warnings.length > 0 ? 'Warnings' : 'No warnings'}>
                {warnings.length > 0 && (
                  <span data-tooltip-id="tooltip-warning" data-tooltip-content={warnings.join(' • ')}>
                    <IconAlertTriangle size={16} className="text-orange-300 inline" />
                  </span>
                )}
              </td>
              {rowAction && <td className="px-2 py-1 text-right whitespace-nowrap">{rowAction(r.setupId)}</td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
});

export default BulkTable;
