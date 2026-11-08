'use client';

import React, {
  useCallback, useEffect, useRef, useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { toJS } from 'mobx';
import {
  IconAlertTriangle, IconBug, IconInfoCircle, IconPlayerStop, IconSearch,
} from '@tabler/icons-react';
import { BestPayload, BestResult } from '@/best/worker/protocol';
import createBestWorker from '@/best/worker/createBestWorker';
import { BestPhase } from '@/best/lib/run';
import { TaskPool, WorkerLimit } from '@/bulk/worker/TaskPool';
import { BulkPool } from '@/bulk/worker/BulkPool';
import createBulkWorker from '@/bulk/worker/createBulkWorker';
import DismissibleNote from '@/bulk/components/DismissibleNote';
import Panel, { buttonClass } from '@/bulk/components/Panel';
import { focusRing } from '@/best/components/fields';
import { RaidStore, RaidStoreContext } from '@/raid/state/RaidStore';
import { replacementsFor, runRaid, searchesNeeded } from '@/raid/lib/runRaid';
import { RaidProgress } from '@/raid/lib/candidates';
import { SearchCache } from '@/raid/lib/searchCache';
import { fetchPrices, itemPrice, Prices } from '@/raid/lib/prices';
import { getCanonicalItemId } from '@/lib/Equipment';
import { debugReport } from '@/raid/lib/debug';
import RaidInputs from '@/raid/components/RaidInputs';
import { AccountFields } from '@/best/components/InputsPanel';
import { AccountEditorContext } from '@/best/state/AccountEditor';
import BossStrip from '@/raid/components/BossStrip';
import LoadoutView from '@/raid/components/LoadoutView';
import BossResults from '@/raid/components/BossResults';
import StyleToggles from '@/raid/components/StyleToggles';

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

/** Time since it appeared, in even-width digits so it holds still; left out of screen readers' status updates, which would read every second */
const Elapsed: React.FC = () => {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.floor((now - start) / 1000);
  return <span aria-hidden className="shrink-0 tabular-nums">{`${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`}</span>;
};

/** How long the inputs stay unchanged before the page checks the cache and re-plans */
export const SETTLE_MS = 300;

const RaidPage: React.FC = observer(() => {
  const [store] = useState(() => new RaidStore());
  const [pools] = useState(() => {
    // one limit for both: a pool's idle workers make way for the other's
    const limit = new WorkerLimit();
    return {
      search: new TaskPool<BestPayload, BestResult>({ createWorker: createBestWorker, terminateOnCancel: true, limit }),
      rows: new BulkPool({ createWorker: createBulkWorker, limit }),
    };
  });
  const [cache] = useState(() => new SearchCache());
  const [cacheLoaded, setCacheLoaded] = useState(false);
  const [prices, setPrices] = useState<Prices | null>(null);
  const [pricesState, setPricesState] = useState<'loading' | 'ok' | 'missing'>('loading');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<RaidProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const runToken = useRef(0);
  const planner = useRef<AbortController | null>(null);

  useEffect(() => {
    store.load().catch(console.error);
    cache.load().then(() => setCacheLoaded(true)).catch(console.error);
    // the saved snapshot, however old: new prices would move items between price tiers and redo cached searches
    fetchPrices(undefined, Date.now(), Infinity).then((p) => {
      setPrices(p);
      setPricesState(p ? 'ok' : 'missing');
    }).catch(() => setPricesState('missing'));
    // unsaved settings and what the running planner found since the last save; a closing page may not finish the write
    const saveAll = () => {
      store.flush();
      cache.flush().catch(console.error);
    };
    window.addEventListener('pagehide', saveAll);
    return () => {
      window.removeEventListener('pagehide', saveAll);
      planner.current?.abort();
      saveAll();
      pools.search.shutdown();
      pools.rows.shutdown();
    };
  }, [store, pools, cache]);

  useEffect(() => {
    if (pricesState !== 'loading') store.setPricesAt(prices?.at ?? null);
  }, [store, prices, pricesState]);

  const { runKey, blockReason } = store;
  const ready = store.loaded && cacheLoaded && pricesState !== 'loading';
  // searches the next run has to do; 0 means it only re-plans from cached searches. Worked out once the inputs settle
  // (typing a budget changes them on every key), null until then. The count is kept with the inputs it is for: right
  // after a change the old count is still there, and a 0 for the old inputs must not start a run with the new ones
  const [checked, setChecked] = useState<{ key: string; count: number } | null>(null);
  const needed = checked?.key === runKey ? checked.count : null;
  useEffect(() => {
    if (!ready) return undefined;
    const key = runKey;
    const timer = setTimeout(() => setChecked({ key, count: searchesNeeded(toJS(store.settings), prices, cache) }), SETTLE_MS);
    return () => clearTimeout(timer);
    // runKey stands for the settings
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, runKey, prices, cache, running]);

  const run = useCallback(async () => {
    if (!ready || store.blockReason) return;
    runToken.current += 1;
    const token = runToken.current;
    const key = store.runKey;
    planner.current?.abort();
    const controller = new AbortController();
    planner.current = controller;
    setRunning(true);
    setError(null);
    setStopped(false);
    setProgress(null);
    try {
      const result = await runRaid(toJS(store.settings), prices, pools, (p) => {
        if (token === runToken.current) setProgress(p);
      }, cache, undefined, controller.signal);
      if (token === runToken.current) store.setResult(result, key, prices?.at ?? null);
    } catch (e) {
      if (!isCancelled(e) && token === runToken.current) {
        setError(e instanceof Error ? e.message : String(e));
        // the run has failed: what the rest of it still has running would only keep the workers busy
        pools.search.cancel();
        pools.rows.cancel();
      }
    } finally {
      if (token === runToken.current) setRunning(false);
    }
  }, [ready, store, prices, pools, cache]);

  // runs only start from the button: a change, however cheap, marks the result stale and waits for it

  // a click on an item rates its replacements: an explicit ask, like the button
  const replacements = useCallback(
    (id: number) => (store.result ? replacementsFor(store.result, toJS(store.settings), id, prices, pools, cache) : Promise.resolve(null)),
    [store, prices, pools, cache],
  );

  const refreshPrices = () => {
    setPricesState('loading');
    // a failed refresh keeps the prices the page has
    const fallback = prices;
    fetchPrices(undefined, Date.now(), 0).catch(() => null).then((p) => {
      setPrices(p ?? fallback);
      setPricesState(p ?? fallback ? 'ok' : 'missing');
    });
  };

  const stop = () => {
    runToken.current += 1;
    planner.current?.abort();
    pools.search.cancel();
    pools.rows.cancel();
    setRunning(false);
    setStopped(true);
  };

  const overall = progress && progress.searches > 0 ? (progress.search / progress.searches) * 100 : 0;
  const { planning } = progress ?? {};
  const share = (p: { done: number; total: number } | null | undefined) => (p && p.total > 0 ? (p.done / p.total) * 100 : 0);
  const inner = share(planning ?? progress?.inner);
  const innerLabel = planning?.label
    ?? (progress?.inner ? `${PHASE_LABELS[progress.inner.phase]} · step ${progress.inner.done} of ${progress.inner.total}` : ' ');
  const { result, stale } = store;

  return (
    <RaidStoreContext.Provider value={store}>
      <div className="max-w-[1920px] mx-auto mt-4 mb-8 px-2 flex flex-col gap-3">
        <DismissibleNote storageKey="dps-raid-note-dismissed">
          <strong>Experimental:</strong>
          {' '}
          a rough raid loadout from solo kill times of each boss&apos;s main health bar. Check important picks in the calculator.
        </DismissibleNote>
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
            <AccountEditorContext.Provider value={store}>
              <Panel title="Your account" className="min-w-0" collapseKey="dps-raid-account-collapsed">
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
                  <AccountFields />
                </div>
              </Panel>
            </AccountEditorContext.Provider>
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
                  <StyleToggles />
                  {(prices?.at !== undefined || pricesState === 'missing') && (
                    <button
                      type="button"
                      className={`text-xs underline text-gray-500 dark:text-gray-300 hover:text-orange-400 rounded ${focusRing}`}
                      data-tooltip-id="tooltip"
                      data-tooltip-content="New prices can change which searches the next run needs"
                      onClick={refreshPrices}
                    >
                      {prices?.at !== undefined ? `Prices from ${new Date(prices.at).toLocaleString()} · refresh` : 'Prices unavailable · try again'}
                    </button>
                  )}
                  {store.result && (
                    <button
                      type="button"
                      className={`text-xs underline text-gray-500 dark:text-gray-300 hover:text-orange-400 rounded ${focusRing}`}
                      data-tooltip-id="tooltip"
                      data-tooltip-content="Download the settings and result as JSON, to share for debugging"
                      onClick={() => {
                        const settings = toJS(store.settings);
                        const owned = new Set(settings.ownedIds.map(getCanonicalItemId));
                        const json = JSON.stringify(debugReport(settings, toJS(store.result!), (id) => itemPrice(id, prices, owned)), null, 2);
                        const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = 'raid-debug.json';
                        a.click();
                        URL.revokeObjectURL(url);
                      }}
                    >
                      <span className="flex items-center gap-1">
                        <IconBug size={14} aria-hidden />
                        Debug JSON
                      </span>
                    </button>
                  )}
                  {!blockReason && needed !== null && needed > 0 && (
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
                      <div className="flex justify-between items-start gap-4">
                        <span>
                          {progress && progress.searches > 0
                            ? `${progress.search} of ${progress.searches} searches done${progress.cached > 0 ? ` (${progress.cached} cached)` : ''}${!planning && progress.phaseLabel ? ` · running ${progress.phaseLabel}` : ''}`
                            : 'Planning the loadout from the cached searches…'}
                        </span>
                        <Elapsed />
                      </div>
                      <Bar label="Searches" value={overall} />
                      <span className="text-xs text-gray-500 dark:text-gray-300">{innerLabel}</span>
                      <Bar label={planning ? 'Planning' : 'Current search'} value={inner} />
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
                      {store.inputsStale ? 'Inputs changed — run again.' : 'Prices changed — run again.'}
                    </span>
                  )}
                  {!running && result && store.resultPricesAt === null && (
                    <span className="flex items-center gap-1 text-orange-500 dark:text-orange-200">
                      <IconAlertTriangle size={14} aria-hidden />
                      This plan was made without prices: every item in it counted as free.
                    </span>
                  )}
                  {!running && stopped && !stale && <span>Search stopped.</span>}
                </div>
              )}
            >
              <div className={`p-4 flex flex-col gap-4 ${running ? 'opacity-60' : ''}`}>
                <BossStrip />
                {result ? (
                  // the loadout beside the boss results on wide screens, staying in view while they scroll
                  <div className="flex flex-col xl:flex-row gap-6 items-start">
                    <div className="w-full xl:w-[26rem] shrink-0 xl:sticky xl:top-16 xl:max-h-[calc(100vh-5rem)] xl:overflow-y-auto flex flex-col">
                      <LoadoutView result={result} prices={prices} replacements={replacements} />
                    </div>
                    <div className="w-full min-w-0 grow">
                      <BossResults result={result} />
                    </div>
                  </div>
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
