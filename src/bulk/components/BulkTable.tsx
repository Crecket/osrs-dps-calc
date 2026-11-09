import React from 'react';
import { observer } from 'mobx-react-lite';
import {
  IconAlertTriangle, IconChevronDown, IconChevronUp, IconCornerDownRight, IconTrophy, IconX,
} from '@tabler/icons-react';
import GearCells from '@/bulk/components/GearCells';
import BuffIcons from '@/bulk/components/BuffIcons';
import {
  behindBest, bestValue, firstClickDir, Mode, NORMAL_COLUMNS, SortKey, SortState, SPEC_COLUMNS,
} from '@/bulk/lib/table';
import { BulkFilters, BulkRow, BulkSetup } from '@/bulk/types';
import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { overriddenSlots } from '@/bulk/lib/filters';
import StyleLabel from '@/bulk/components/StyleLabel';
import { SetupCost } from '@/bulk/lib/cost';
import { formatGp } from '@/raid/lib/format';

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
  /** Added to every worn item's tooltip, e.g. how to use the right-click */
  itemHint?: string;
  /** A row to pick out as the best, e.g. the highest DPS */
  highlightId?: string;
  /**
   * Rows shown as alternatives of the ranked row above them: no rank of their own, the label in place of the setup name,
   * and the slots that differ marked
   */
  alternatives?: Map<string, { label: string; slots: (keyof PlayerEquipment)[] }>;
  /** Value columns to show first, right after the rank, in this order */
  leadColumns?: SortKey[];
  /** Leave out setup names: the column only shows the attack style or spell, and an alternative's label */
  hideNames?: boolean;
  /** Add a column with how far each ranked row is behind the best one */
  showBehind?: boolean;
  /** Add a cost column with these costs by setup; null is no prices, which shows a dash rather than 0 */
  costs?: Map<string, SetupCost> | null;
  /** Explains the cost column */
  costTooltip?: string;
}

const costDetail = (cost: SetupCost) => [
  `${cost.total.toLocaleString()} gp`,
  ...(cost.unpriced.length > 0 ? [`Counted as free: ${cost.unpriced.join(', ')}`] : []),
].join(' • ');

// shown after the value it compares
const BEHIND_AFTER: Record<Mode, SortKey> = { normal: 'dps', spec: 'specExpected' };
const BEHIND_TOOLTIP: Record<Mode, string> = {
  normal: "How far this setup's DPS is behind the best shown setup",
  spec: "How far this setup's spec damage is behind the best shown setup",
};

const rowClass = (highlighted: boolean, alternative: boolean) => {
  if (highlighted) return 'bg-orange-100 dark:bg-orange-500/30';
  if (alternative) return 'bg-body-100/70 dark:bg-dark-500/60 text-gray-600 dark:text-gray-300';
  return 'odd:bg-body-100/40 dark:odd:bg-dark-400/40';
};

// observer, so renaming a setup re-renders rows without the parent having to
const BulkTable: React.FC<BulkTableProps> = observer(({
  rows, setups, mode, sort, onSort, hasRun, overrides = {}, filtered = new Map(), stale = new Set(), rowAction, onItemContextMenu,
  itemHint, highlightId, alternatives, leadColumns = [], hideNames, showBehind, costs, costTooltip,
}) => {
  // not memoized: preset arrays are mutated in place, so their identity can't be used as a dependency
  const setupsById = new Map(setups.map((s) => [s.id, s]));
  const allColumns = mode === 'spec' ? SPEC_COLUMNS : NORMAL_COLUMNS;
  const lead = leadColumns.flatMap((k) => allColumns.filter((c) => c.key === k));
  const valueColumns = allColumns.filter((c) => !leadColumns.includes(c.key));
  // only what is ranked counts: a hidden or greyed out setup isn't the best one to be behind
  const best = showBehind ? bestValue(rows.filter((r) => !filtered.has(r.setupId) && !alternatives?.has(r.setupId)), mode) : null;
  let rank = 0;

  const clickHeader = (key: SortKey) => {
    if (sort.key === key) {
      onSort({ key, dir: sort.dir === 'asc' ? 'desc' : 'asc' });
    } else {
      onSort({ key, dir: firstClickDir(key) });
    }
  };

  const ariaSort = (key: SortKey) => {
    if (sort.key !== key) return 'none';
    return sort.dir === 'asc' ? 'ascending' : 'descending';
  };

  const header = (c: { key: SortKey; label: string }, tooltip?: string) => (
    <th key={c.key} className="px-2 py-1.5 text-right whitespace-nowrap" aria-sort={ariaSort(c.key)} data-tooltip-id={tooltip && 'tooltip'} data-tooltip-content={tooltip}>
      <button type="button" className="inline-flex items-center gap-0.5 hover:text-orange-200" onClick={() => clickHeader(c.key)}>
        {c.label}
        {sort.key === c.key && (sort.dir === 'asc' ? <IconChevronUp size={14} /> : <IconChevronDown size={14} />)}
      </button>
    </th>
  );

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
          {lead.map((c) => header(c))}
          <th className="px-2 py-1.5">{hideNames ? 'Style' : 'Setup'}</th>
          <th className="px-2 py-1.5">Gear</th>
          <th className="px-2 py-1.5">Buffs</th>
          {valueColumns.map((c) => (
            <React.Fragment key={c.key}>
              {header(c)}
              {showBehind && c.key === BEHIND_AFTER[mode] && (
                <th className="px-2 py-1.5 text-right whitespace-nowrap" data-tooltip-id="tooltip" data-tooltip-content={BEHIND_TOOLTIP[mode]}>Behind</th>
              )}
            </React.Fragment>
          ))}
          {costs && header({ key: 'cost', label: 'Cost' }, costTooltip)}
          {costs === null && <th className="px-2 py-1.5 text-right whitespace-nowrap" data-tooltip-id="tooltip" data-tooltip-content={costTooltip}>Cost</th>}
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
          const alternative = alternatives?.get(r.setupId);
          const highlighted = r.setupId === highlightId;
          if (!reason && !alternative) rank += 1;

          const behind = reason || alternative ? null : behindBest(r, best, mode);
          const cost = costs?.get(r.setupId);

          // a failed row shows its error once, in the first group of value cells
          const values = (cols: typeof valueColumns, showError: boolean, extraCells = 0) => {
            if (cols.length === 0) return null;
            if (r.error) {
              return (
                <td colSpan={cols.length + extraCells} className="px-2 py-1 text-right text-red-400">
                  {showError && (
                    <span className="inline-flex items-center gap-1">
                      <IconX size={16} />
                      {r.error}
                    </span>
                  )}
                </td>
              );
            }
            const staleClass = isStale ? 'text-gray-400 italic' : '';
            const staleTitle = isStale ? 'Recalculating' : undefined;
            return cols.map((c) => (
              <React.Fragment key={c.key}>
                <td className={`px-2 py-1 text-right tabular-nums ${sort.key === c.key ? 'font-bold' : ''} ${staleClass}`} title={staleTitle}>
                  {formatValue(r, c.key)}
                </td>
                {showBehind && c.key === BEHIND_AFTER[mode] && (
                  <td className={`px-2 py-1 text-right tabular-nums ${staleClass}`} title={staleTitle}>
                    {behind === null ? '—' : `${(behind * 100).toFixed(2)}%`}
                  </td>
                )}
              </React.Fragment>
            ));
          };

          const warnings = [...r.issues];
          if (r.spec?.partial) warnings.push('Spec only partially supported');

          return (
            <tr
              key={r.setupId}
              className={`border-b border-body-200 dark:border-dark-400 ${rowClass(highlighted, !!alternative)} ${reason ? 'opacity-40' : ''}`}
            >
              {/* the highlight's accent bar sits on the first cell: not every browser draws a row's own box-shadow */}
              <td className={`px-2 py-1 text-center text-gray-500 dark:text-gray-300 ${highlighted ? 'shadow-[inset_3px_0_0_theme(colors.orange.300)]' : ''}`}>
                {highlighted && !reason && !alternative ? (
                  <span className="inline-flex items-center justify-center text-orange-400 dark:text-orange-300" data-tooltip-id="tooltip" data-tooltip-content="Best">
                    <IconTrophy size={16} aria-hidden />
                    <span className="sr-only">{rank}</span>
                  </span>
                ) : (!alternative && (reason ? '—' : rank))}
              </td>
              {values(lead, true)}
              <td className="px-2 py-1 whitespace-nowrap">
                {alternative ? (
                  <span className="inline-flex items-center gap-1 pl-2 text-xs">
                    <IconCornerDownRight size={14} aria-hidden className="shrink-0 text-gray-400" />
                    {alternative.label}
                  </span>
                ) : (
                  <>
                    {!hideNames && <span className="font-semibold mr-1">{setup.name}</span>}
                    <StyleLabel player={setup.player} className="align-middle" />
                  </>
                )}
                {reason && <span className="ml-2 text-xs italic">{reason}</span>}
              </td>
              <td className="px-2 py-1" aria-label="Gear">
                <GearCells
                  player={setup.player}
                  marked={alternative ? alternative.slots : overriddenSlots(setup.player, overrides)}
                  markedNote={alternative ? ' (differs from the ranked setup above)' : undefined}
                  onItemContextMenu={onItemContextMenu}
                  itemHint={itemHint}
                />
              </td>
              <td className="px-2 py-1 whitespace-nowrap" aria-label="Prayers and potions"><BuffIcons player={setup.player} /></td>
              {values(valueColumns, lead.length === 0, showBehind ? 1 : 0)}
              {costs !== undefined && (
                <td
                  className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${sort.key === 'cost' ? 'font-bold' : ''}`}
                  data-tooltip-id={cost ? 'tooltip' : undefined}
                  data-tooltip-content={cost ? costDetail(cost) : undefined}
                >
                  {cost ? formatGp(cost.total) : '—'}
                </td>
              )}
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
