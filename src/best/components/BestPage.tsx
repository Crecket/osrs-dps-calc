'use client';

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import { toast } from 'react-toastify';
import {
  IconAlertTriangle, IconPlayerStop, IconPlus, IconSearch,
} from '@tabler/icons-react';
import { BestStore, BestStoreContext } from '@/best/state/BestStore';
import { runBestSetup, StyleOutcome } from '@/best/lib/run';
import { BestPayload, BestResult } from '@/best/worker/protocol';
import createBestWorker from '@/best/worker/createBestWorker';
import { TaskPool } from '@/bulk/worker/TaskPool';
import { BulkPool } from '@/bulk/worker/BulkPool';
import createBulkWorker from '@/bulk/worker/createBulkWorker';
import { BulkStore } from '@/bulk/state/BulkStore';
import { notifyPresetsChanged } from '@/bulk/state/presetChannel';
import { newId } from '@/bulk/lib/presetIO';
import { defaultSort, selectRows, SortState } from '@/bulk/lib/table';
import { monsterLabel } from '@/bulk/lib/format';
import { BulkSetup } from '@/bulk/types';
import TargetMonster from '@/bulk/components/TargetMonster';
import BulkTable from '@/bulk/components/BulkTable';
import Panel, { buttonClass } from '@/bulk/components/Panel';
import InputsPanel, { styleName } from '@/best/components/InputsPanel';

const isCancelled = (e: unknown) => e instanceof Error && e.message === 'cancelled';

/**
 * Saves a result as a setup in the bulk tool's active preset, read fresh from storage so the bulk page's own state isn't
 * needed here.
 */
const addToBulkPreset = async (setup: BulkSetup) => {
  const bulk = new BulkStore();
  // load always leaves an active preset
  await bulk.load();
  const preset = bulk.active;
  if (!bulk.persists() || !preset) {
    toast.error('The bulk tool\'s presets could not be read, so the setup was not added');
    return;
  }
  const result = bulk.addSetups([{ id: newId(), name: setup.name, player: toJS(setup.player) }]);
  if (result.added === 0) {
    toast.info(`That setup is already in ${preset.name}`);
    return;
  }
  if (!await bulk.whenSaved()) {
    toast.error('Could not save the bulk tool\'s presets');
    return;
  }
  notifyPresetsChanged();
  toast.success(`Added to ${preset.name}`);
};

interface Pools {
  search: TaskPool<BestPayload, BestResult>;
  rows: BulkPool;
}

const StyleResults: React.FC<{ outcome: StyleOutcome; sort: SortState; onSort: (s: SortState) => void }> = ({
  outcome, sort, onSort,
}) => {
  const setupsById = new Map(outcome.setups.map((s) => [s.id, s]));
  return (
    <Panel
      title={(
        <>
          {styleName(outcome.style)}
          {outcome.approximate && (
            <span
              className="text-xs font-sans font-normal px-1.5 py-0.5 rounded bg-orange-400/20 text-orange-600 dark:text-orange-300"
              data-tooltip-id="tooltip"
              data-tooltip-content="Some of these setups come from a quicker search that may miss the best one"
            >
              approximate
            </span>
          )}
        </>
      )}
    >
      {outcome.message ? (
        <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">{outcome.message}</p>
      ) : (
        <div className="overflow-x-auto max-w-[100vw]">
          <BulkTable
            rows={selectRows(outcome.rows, { mode: 'normal', sort })}
            setups={outcome.setups}
            mode="normal"
            sort={sort}
            onSort={onSort}
            hasRun
            rowAction={(id) => {
              const setup = setupsById.get(id);
              return setup && (
                <button
                  type="button"
                  className={buttonClass}
                  onClick={() => addToBulkPreset(setup).catch((e) => toast.error(e instanceof Error ? e.message : String(e)))}
                >
                  <span className="flex items-center gap-1">
                    <IconPlus size={16} />
                    Add to bulk preset
                  </span>
                </button>
              );
            }}
          />
        </div>
      )}
    </Panel>
  );
};

const BestResults: React.FC<{ store: BestStore; pools: Pools }> = observer(({ store, pools }) => {
  const [outcomes, setOutcomes] = useState<StyleOutcome[]>([]);
  // the runKey the shown results were searched with; results go stale when the inputs or the monster change
  const [resultKey, setResultKey] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [sort, setSort] = useState<SortState>(defaultSort('normal'));
  const runToken = useRef(0);

  // the only way a search starts: the Find best setup button
  const run = useCallback(async () => {
    const { monster, runKey } = store;
    if (!store.loaded || runKey === null || !monster) return;
    runToken.current += 1;
    const token = runToken.current;
    setStopped(false);
    setRunning(true);
    setProgress({ done: 0, total: 0 });
    try {
      // a newer call cancels this one itself
      const result = await runBestSetup(toJS(store.inputs), toJS(monster), pools, (done, total) => {
        if (token === runToken.current) setProgress({ done, total });
      });
      if (token === runToken.current) {
        setOutcomes(result);
        setResultKey(runKey);
      }
    } catch (e) {
      if (!isCancelled(e)) toast.error(e instanceof Error ? e.message : 'Search failed');
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

  const { monster } = store;
  const pct = progress && progress.total > 0 ? (progress.done / progress.total) * 100 : 0;
  const stale = outcomes.length > 0 && resultKey !== store.runKey;

  return (
    <Panel
      title={monster ? `Best setups vs ${monsterLabel(monster)}` : 'Best setups'}
      actions={(
        <>
          {stale && !running && (
            <span className="text-xs text-orange-700 dark:text-orange-300">Inputs changed — results are out of date</span>
          )}
          {running ? (
            <button type="button" className={`${buttonClass} font-bold`} onClick={stop}>
              <span className="flex items-center gap-1">
                <IconPlayerStop size={16} />
                {progress && progress.total > 0 ? `Stop (${progress.done} / ${progress.total})` : 'Stop'}
              </span>
            </button>
          ) : (
            <button
              type="button"
              className={`${buttonClass} !bg-orange-400 dark:!bg-orange-700 font-bold`}
              disabled={!store.loaded || !monster}
              onClick={run}
            >
              <span className="flex items-center gap-1">
                <IconSearch size={16} />
                Find best setup
              </span>
            </button>
          )}
        </>
      )}
    >
      {/* always the same height, so a run starting or finishing doesn't move the results */}
      <div className="h-1 bg-body-200 dark:bg-dark-500">
        {running && <div className="h-full bg-orange-400 dark:bg-orange-600 transition-all" style={{ width: `${pct}%` }} />}
      </div>
      {!monster && <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">Pick a monster</p>}
      {monster && running && <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">Searching...</p>}
      {monster && !running && stopped && (
        <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">Search stopped. Click Find best setup to search again.</p>
      )}
      {monster && !running && !stopped && outcomes.length === 0 && (
        <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">Set your stats and click Find best setup.</p>
      )}
      {outcomes.length > 0 && (
        <div className={`flex flex-col gap-3 p-3 ${stale ? 'opacity-60' : ''}`}>
          {outcomes.map((o) => <StyleResults key={o.style} outcome={o} sort={sort} onSort={setSort} />)}
        </div>
      )}
    </Panel>
  );
});

const BestPage: React.FC = observer(() => {
  const [store] = useState(() => new BestStore());
  const [pools] = useState<Pools>(() => ({
    search: new TaskPool<BestPayload, BestResult>({ createWorker: createBestWorker }),
    rows: new BulkPool({ createWorker: createBulkWorker }),
  }));

  useEffect(() => {
    store.load().catch(console.error);
    return () => {
      pools.search.shutdown();
      pools.rows.shutdown();
    };
  }, [store, pools]);

  return (
    <BestStoreContext.Provider value={store}>
      <div className="max-w-[1420px] mx-auto mt-4 mb-8 px-2 flex flex-col gap-3">
        {store.readFailed && (
          <div className="flex items-center gap-2 px-4 py-2 rounded bg-orange-100 dark:bg-orange-900/60 text-orange-900 dark:text-orange-100 text-sm">
            <IconAlertTriangle size={18} />
            Saved best setup settings could not be read, so changes in this tab will not be saved. Try reloading the page.
          </div>
        )}
        {store.loaded ? (
          <>
            <div className="flex gap-3 flex-wrap">
              <InputsPanel />
              <TargetMonster holder={store} />
            </div>
            <BestResults store={store} pools={pools} />
          </>
        ) : (
          <p className="text-white text-sm">Loading...</p>
        )}
      </div>
    </BestStoreContext.Provider>
  );
});

export default BestPage;
