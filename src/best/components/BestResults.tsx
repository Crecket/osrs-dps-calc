import React, { useCallback, useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import { toast } from 'react-toastify';
import {
  IconAlertTriangle, IconClick, IconInfoCircle, IconPlayerStop, IconSearch, IconTrophy,
} from '@tabler/icons-react';
import { BestStore } from '@/best/state/BestStore';
import { BestPhase, runBestSetup, StyleOutcome } from '@/best/lib/run';
import { BestPayload, BestResult } from '@/best/worker/protocol';
import { TaskPool } from '@/bulk/worker/TaskPool';
import { BulkPool } from '@/bulk/worker/BulkPool';
import { defaultSort, SortState } from '@/bulk/lib/table';
import { monsterLabel } from '@/bulk/lib/format';
import { EquipmentPiece } from '@/types/Player';
import { availableEquipment } from '@/lib/Equipment';
import Panel, { buttonClass } from '@/bulk/components/Panel';
import { BEST_STYLES } from '@/best/types';
import { focusRing, STYLE_ICONS, styleName } from '@/best/components/fields';
import StyleResults from '@/best/components/StyleResults';
import StyleSummary from '@/best/components/StyleSummary';

export interface Pools {
  search: TaskPool<BestPayload, BestResult>;
  rows: BulkPool;
}

const isCancelled = (e: unknown) => e instanceof Error && e.message === 'cancelled';

const PHASE_LABELS: Record<BestPhase, string> = {
  effects: 'Checking which item effects matter',
  descent: 'Trying every weapon',
  exhaustive: 'Trying gear combinations for the strongest weapons',
};

/** The styles to search, as toggle buttons; at least one stays on. Changing them runs nothing. */
const StyleToggles: React.FC<{ store: BestStore }> = observer(({ store }) => {
  const { styles } = store.inputs;
  return (
    <div className="flex rounded overflow-hidden border border-body-500 dark:border-dark-200" role="group" aria-label="Styles">
      {BEST_STYLES.map((s) => {
        const on = styles.includes(s);
        return (
          <button
            key={s}
            type="button"
            className={`flex items-center gap-1 h-8 px-1.5 sm:px-2 text-sm transition-colors ${focusRing} focus-visible:ring-inset ${on
              ? 'bg-orange-400 dark:bg-orange-700 text-white'
              : 'bg-btns-400 dark:bg-dark-500 text-gray-300 hover:bg-btns-300 dark:hover:bg-dark-400'} disabled:cursor-not-allowed`}
            aria-pressed={on}
            disabled={on && styles.length === 1}
            data-tooltip-id="tooltip"
            data-tooltip-content={on && styles.length === 1 ? 'At least one style is searched' : undefined}
            onClick={() => store.setStyles(on ? styles.filter((x) => x !== s) : BEST_STYLES.filter((x) => x === s || styles.includes(x)))}
          >
            <img className={`hidden sm:block w-4 h-4 object-contain ${on ? '' : 'opacity-50 grayscale'}`} src={STYLE_ICONS[s].src} alt="" />
            {styleName(s)}
          </button>
        );
      })}
    </div>
  );
});

/** A line under the toolbar: what the search is doing, or why the results shown may not match the inputs. */
const StatusLine: React.FC<React.PropsWithChildren<{ tone: 'info' | 'warn' | 'error'; icon: React.ReactNode }>> = ({ tone, icon, children }) => {
  const colours = {
    info: 'text-gray-600 dark:text-gray-300',
    warn: 'text-orange-500 dark:text-orange-200 bg-orange-100/60 dark:bg-orange-500/20',
    error: 'text-red-400 dark:text-red-200 bg-red-100/60 dark:bg-red-500/30',
  }[tone];
  return (
    <div className={`px-4 py-1.5 flex items-center gap-2 text-sm border-b border-body-300 dark:border-dark-200 ${colours}`} role="status">
      <span className="shrink-0" aria-hidden>{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
};

/** What the page does before the first search. */
const Intro: React.FC<{ hasMonster: boolean }> = ({ hasMonster }) => (
  <div className="px-4 py-8 flex flex-col items-center text-center gap-3">
    <IconTrophy size={32} className="text-orange-400 dark:text-orange-300" aria-hidden />
    <h3 className="font-serif font-bold text-lg">{hasMonster ? 'Ready when you are' : 'Pick a monster to search against'}</h3>
    <p className="max-w-prose text-sm text-gray-600 dark:text-gray-300">
      {hasMonster
        ? 'Find best setup tries every weapon against this monster with your levels, prayers and potions, then every gear combination for the strongest ones. It takes about 15 to 20 seconds, and nothing runs until you click it.'
        : 'Choose a monster in the monster panel, set your levels, prayers and potions, then click Find best setup.'}
    </p>
    <ul className="text-xs text-gray-500 dark:text-gray-300 flex flex-col gap-1">
      <li>Each style shows its best setup for each of its top weapons.</li>
      <li>Right-click an item in a result to leave it out of the next search.</li>
    </ul>
  </div>
);

const BestResults: React.FC<{ store: BestStore; pools: Pools }> = observer(({ store, pools }) => {
  const [outcomes, setOutcomes] = useState<StyleOutcome[]>([]);
  // the runKey the shown results were searched with; results go stale when the inputs or the monster change
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number; phase: BestPhase | null } | null>(null);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>(defaultSort('normal'));
  const runToken = useRef(0);

  // the only way a search starts: the Find best setup button
  const run = useCallback(async () => {
    const { monster, runKey } = store;
    if (!store.loaded || runKey === null || !monster) return;
    runToken.current += 1;
    const token = runToken.current;
    setStopped(false);
    setError(null);
    setRunning(true);
    setProgress({ done: 0, total: 0, phase: null });
    try {
      // a newer call cancels this one itself
      const result = await runBestSetup(toJS(store.inputs), toJS(monster), pools, (done, total, phase) => {
        if (token === runToken.current) setProgress({ done, total, phase });
      });
      if (token === runToken.current) {
        setOutcomes(result);
        setResultKey(runKey);
      }
    } catch (e) {
      if (!isCancelled(e) && token === runToken.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === runToken.current) setRunning(false);
    }
  }, [store, pools]);

  const stop = () => {
    // the stopped run's result, should it still arrive, is ignored
    runToken.current += 1;
    pools.search.cancel();
    pools.rows.cancel();
    setRunning(false);
    setStopped(true);
  };

  // a right-click on an item in a result leaves it (and the variants it stands for) out of the next search; nothing
  // runs until the button is clicked
  const exclude = (item: EquipmentPiece, variants: number[]) => {
    const names = [item.name];
    store.excludeItem(item.id);
    variants.forEach((id) => {
      store.excludeItem(id);
      names.push(availableEquipment.find((e) => e.id === id)?.name ?? String(id));
    });
    const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    toast.info(`Excluded ${list}. Click Find best setup to update the results.`);
  };

  const { monster } = store;
  const pct = progress && progress.total > 0 ? Math.min(100, (progress.done / progress.total) * 100) : 0;
  const stale = outcomes.length > 0 && resultKey !== store.runKey;

  // one line at a time, the most pressing first
  let status: React.ReactNode = null;
  if (running) {
    status = (
      <StatusLine tone="info" icon={<IconSearch size={16} className="animate-pulse" />}>
        <span>{progress?.phase ? PHASE_LABELS[progress.phase] : 'Starting the search'}</span>
        <span className="ml-2 tabular-nums font-semibold">{`${Math.round(pct)}%`}</span>
      </StatusLine>
    );
  } else if (error) {
    status = (
      <StatusLine tone="error" icon={<IconAlertTriangle size={16} />}>
        {`The search failed: ${error}. Click Find best setup to try again.`}
      </StatusLine>
    );
  } else if (stale) {
    status = (
      <StatusLine tone="warn" icon={<IconInfoCircle size={16} />}>
        Inputs changed since this search. Click Find best setup to update the results.
      </StatusLine>
    );
  } else if (stopped) {
    status = (
      <StatusLine tone="info" icon={<IconPlayerStop size={16} />}>
        {outcomes.length > 0 ? 'Search stopped. These are the results of the last finished search.' : 'Search stopped. Click Find best setup to search again.'}
      </StatusLine>
    );
  }

  return (
    <Panel
      title={monster ? `Best setups vs ${monsterLabel(monster)}` : 'Best setups'}
      stickyHeader
      actions={(
        <>
          <StyleToggles store={store} />
          {running ? (
            <button type="button" className={`${buttonClass} h-8 font-bold ${focusRing}`} onClick={stop}>
              <span className="flex items-center gap-1">
                <IconPlayerStop size={16} aria-hidden />
                Stop
              </span>
            </button>
          ) : (
            <button
              type="button"
              className={`${buttonClass} h-8 px-3 !bg-orange-400 dark:!bg-orange-700 hover:!bg-orange-500 dark:hover:!bg-orange-600 !border-orange-500 dark:!border-orange-600 font-bold ${focusRing}`}
              disabled={!store.loaded || !monster}
              onClick={run}
            >
              <span className="flex items-center gap-1">
                <IconSearch size={16} aria-hidden />
                Find best setup
              </span>
            </button>
          )}
        </>
      )}
      belowHeader={(
        <>
          {/* always the same height, so a run starting or finishing doesn't move the results */}
          <div className="h-1 bg-body-200 dark:bg-dark-500" aria-hidden>
            {running && <div className="h-full bg-orange-400 dark:bg-orange-600 transition-all" style={{ width: `${pct}%` }} />}
          </div>
          {status}
        </>
      )}
    >
      {outcomes.length === 0 && !running && !stopped && !error && <Intro hasMonster={!!monster} />}
      {outcomes.length === 0 && running && (
        <p className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-300">Searching... the results appear here when it finishes.</p>
      )}
      {outcomes.length > 0 && (
        <div className={`transition-opacity ${stale || running ? 'opacity-60' : ''}`}>
          {outcomes.length > 1 && <StyleSummary outcomes={outcomes} />}
          <p className="px-4 pt-2 pb-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-300">
            <IconClick size={14} aria-hidden />
            Right-click an item to leave it out of the next search.
          </p>
          <div className="flex flex-col divide-y divide-body-300 dark:divide-dark-200">
            {outcomes.map((o) => <StyleResults key={o.style} outcome={o} sort={sort} onSort={setSort} onExclude={exclude} />)}
          </div>
        </div>
      )}
    </Panel>
  );
});

export default BestResults;
