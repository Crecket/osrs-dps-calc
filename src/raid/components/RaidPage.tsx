'use client';

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import {
  IconAlertTriangle, IconInfoCircle, IconPlayerStop, IconSearch,
} from '@tabler/icons-react';
import { BestPayload, BestResult } from '@/best/worker/protocol';
import createBestWorker from '@/best/worker/createBestWorker';
import { BestPhase } from '@/best/lib/run';
import { TaskPool } from '@/bulk/worker/TaskPool';
import { BulkPool } from '@/bulk/worker/BulkPool';
import createBulkWorker from '@/bulk/worker/createBulkWorker';
import Panel, { buttonClass } from '@/bulk/components/Panel';
import { focusRing } from '@/best/components/fields';
import { RaidStore, RaidStoreContext } from '@/raid/state/RaidStore';
import { runRaid, searchesNeeded } from '@/raid/lib/runRaid';
import { RaidProgress } from '@/raid/lib/candidates';
import { SearchCache } from '@/raid/lib/searchCache';
import { fetchPrices, Prices } from '@/raid/lib/prices';
import RaidInputs from '@/raid/components/RaidInputs';
import BossStrip from '@/raid/components/BossStrip';
import LoadoutView from '@/raid/components/LoadoutView';
import BossResults from '@/raid/components/BossResults';

const isCancelled = (e: unknown) => e instanceof Error && e.message === 'cancelled';

const PHASE_LABELS: Record<BestPhase, string> = {
  effects: 'Checking which item effects matter',
  descent: 'Trying every weapon',
  exhaustive: 'Trying gear combinations',
};

const Bar: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="h-1.5 rounded bg-body-200 dark:bg-dark-500 overflow-hidden" role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}>
    <div className="h-full bg-orange-400 dark:bg-orange-600 transition-all" style={{ width: `${value}%` }} />
  </div>
);

const RaidPage: React.FC = observer(() => {
  const [store] = useState(() => new RaidStore());
  const [pools] = useState(() => ({
    search: new TaskPool<BestPayload, BestResult>({ createWorker: createBestWorker, terminateOnCancel: true }),
    rows: new BulkPool({ createWorker: createBulkWorker }),
  }));
  const [cache] = useState(() => new SearchCache());
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [pricesState, setPricesState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RaidProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const runToken = useRef(0);

  useEffect(() => {
    store.load().catch(console.error);
    cache.load().then(() => setCacheLoaded(true)).catch(console.error);
    // the saved snapshot, however old: new prices would move items between price tiers and redo cached searches
    fetchPrices(undefined, Date.now(), Infinity).then((p) => {
      setPrices(p);
      setPricesState(p ? 'ok' : 'missing');
    }).catch(() => setPricesState('missing'));
    return () => {
      pools.search.shutdown();
      pools.rows.shutdown();
    };
  }, [store, pools, cache]);

  const { runKey, blockReason } = store;
  const ready = store.loaded && cacheLoaded && pricesState !== 'loading';
  // searches the next run has to do; 0 means it only re-plans from cached searches
  const needed = useMemo(
    () => (ready ? searchesNeeded(toJS(store.settings), prices, cache) : 0),
    // runKey stands for the settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, runKey, prices, cache, running],
  );

  const run = useCallback(async () => {
    if (!ready || store.blockReason) return;
    runToken.current += 1;
    const token = runToken.current;
    const key = store.runKey;
    setRunning(true);
    setError(null);
    setStopped(false);
    setProgress(null);
    try {
      const result = await runRaid(toJS(store.settings), prices, pools, (p) => {
        if (token === runToken.current) setProgress(p);
      }, cache);
      if (token === runToken.current) store.setResult(result, key);
    } catch (e) {
      if (!isCancelled(e) && token === runToken.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (token === runToken.current) setRunning(false);
    }
  }, [ready, store, prices, pools, cache]);

  // cheap changes (supplies, magic slots, rules, owned items that need no new search) re-plan straight away
  useEffect(() => {
    // not after a failure or a stop, so it doesn't retry by itself
    if (ready && !running && !error && !stopped && needed === 0 && !blockReason && (store.stale || !store.result)) run();
  }, [ready, running, error, stopped, needed, blockReason, runKey, store, run]);

  const refreshPrices = () => {
    setPricesState('loading');
    fetchPrices(undefined, Date.now(), 0).then((p) => {
      setPrices(p);
      setPricesState(p ? 'ok' : 'missing');
    }).catch(() => setPricesState('missing'));
  };

  const stop = () => {
    runToken.current += 1;
    pools.search.cancel();
    pools.rows.cancel();
    setRunning(false);
    setStopped(true);
  };

  const overall = progress && progress.searches > 0 ? (progress.search / progress.searches) * 100 : 0;
  const inner = progress?.inner && progress.inner.total > 0 ? (progress.inner.done / progress.inner.total) * 100 : 0;
  const { result, stale } = store;

  return (
    <RaidStoreContext.Provider value={store}>
      <div className="max-w-[1920px] mx-auto mt-4 mb-8 px-2 flex flex-col gap-3">
        <div role="note" className="flex items-start gap-2 px-4 py-2 rounded bg-orange-100 dark:bg-orange-500/60 text-orange-500 dark:text-orange-100 text-sm border border-orange-200 dark:border-orange-400">
          <IconAlertTriangle size={18} className="shrink-0 mt-px" aria-hidden />
          <span>
            <strong>Experimental:</strong>
            {' '}
            a rough raid loadout from solo kill times of each boss&apos;s main health bar. Check important picks in the calculator.
          </span>
        </div>
        {pricesState === 'missing' && (
          <div role="alert" className="px-4 py-2 rounded text-sm bg-orange-100 dark:bg-orange-500/40 text-orange-500 dark:text-orange-100">
            Prices unavailable — every item counts as free.
          </div>
        )}
        {store.readFailed && (
          <div role="alert" className="px-4 py-2 rounded text-sm bg-orange-100 dark:bg-orange-500/40 text-orange-500 dark:text-orange-100">
            Saved raid settings could not be read, so changes in this tab will not be saved. Try reloading the page.
          </div>
        )}
        {store.loaded ? (
          <>
            <RaidInputs />
            <Panel
              title="Raid gear"
              stickyHeader
              actions={running ? (
                <button type="button" className={`${buttonClass} h-8 font-bold ${focusRing}`} onClick={stop}>
                  <span className="flex items-center gap-1">
                    <IconPlayerStop size={16} aria-hidden />
                    Stop
                  </span>
                </button>
              ) : (
                <>
                  {prices?.at !== undefined && (
                    <button
                      type="button"
                      className={`text-xs underline text-gray-500 dark:text-gray-300 hover:text-orange-400 rounded ${focusRing}`}
                      data-tooltip-id="tooltip"
                      data-tooltip-content="New prices can change which searches the next run needs"
                      onClick={refreshPrices}
                    >
                      {`Prices from ${new Date(prices.at).toLocaleString()} · refresh`}
                    </button>
                  )}
                  {!blockReason && needed > 0 && (
                    <span className="text-xs text-gray-500 dark:text-gray-300">{`${needed} search${needed === 1 ? '' : 'es'} to run`}</span>
                  )}
                  <button
                    type="button"
                    className={`${buttonClass} h-8 px-3 !bg-orange-400 dark:!bg-orange-700 hover:!bg-orange-500 font-bold ${focusRing}`}
                    disabled={!ready || !!blockReason}
                    onClick={run}
                  >
                    <span className="flex items-center gap-1">
                      <IconSearch size={16} aria-hidden />
                      Find raid gear
                    </span>
                  </button>
                </>
              )}
              belowHeader={(
                <div className="px-4 py-1.5 flex flex-col gap-1 text-sm border-b border-body-300 dark:border-dark-200" role="status">
                  {running && (
                    <>
                      <span>
                        {progress && progress.searches > 0
                          ? `${progress.search} of ${progress.searches} searches done${progress.cached > 0 ? ` (${progress.cached} cached)` : ''}${progress.phaseLabel ? ` · running ${progress.phaseLabel}` : ''}`
                          : 'Planning'}
                      </span>
                      <Bar label="Searches" value={overall} />
                      <span className="text-xs text-gray-500 dark:text-gray-300">{progress?.inner ? PHASE_LABELS[progress.inner.phase] : ' '}</span>
                      <Bar label="Current search" value={inner} />
                    </>
                  )}
                  {!running && blockReason && (
                    <span className="flex items-center gap-1 text-orange-500 dark:text-orange-200">
                      <IconAlertTriangle size={14} aria-hidden />
                      {`${blockReason}: pick Standard spells or No spells, or turn boss rules off.`}
                    </span>
                  )}
                  {!running && !blockReason && error && <span className="text-red-400">{`The search failed: ${error}`}</span>}
                  {!running && !blockReason && !error && stale && (
                    <span className="flex items-center gap-1 text-orange-500 dark:text-orange-200">
                      <IconInfoCircle size={14} aria-hidden />
                      Inputs changed — run again.
                    </span>
                  )}
                  {!running && stopped && !stale && <span>Search stopped.</span>}
                </div>
              )}
            >
              <div className={`p-4 flex flex-col gap-4 ${stale || running ? 'opacity-60' : ''}`}>
                <BossStrip />
                {result ? (
                  <>
                    <LoadoutView result={result} prices={prices} />
                    <BossResults result={result} />
                  </>
                ) : (
                  <p className="text-sm text-gray-500 dark:text-gray-300 text-center py-6">Click Find raid gear to plan a loadout.</p>
                )}
              </div>
            </Panel>
          </>
        ) : (
          <p className="text-white text-sm">Loading your saved settings...</p>
        )}
      </div>
    </RaidStoreContext.Provider>
  );
});

export default RaidPage;
