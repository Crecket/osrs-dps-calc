'use client';

import React, {
  useEffect, useMemo, useRef, useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { reaction, toJS } from 'mobx';
import { toast } from 'react-toastify';
import { IconFileExport, IconPlayerStop } from '@tabler/icons-react';
import { BulkStore, BulkStoreContext } from '@/bulk/state/BulkStore';
import { BulkPool } from '@/bulk/worker/BulkPool';
import createBulkWorker from '@/bulk/worker/createBulkWorker';
import {
  defaultSort, Mode, runKey, selectRows, SortState,
} from '@/bulk/lib/table';
import { monsterLabel, rowsToCsv } from '@/bulk/lib/format';
import { BulkRow } from '@/bulk/types';
import PresetBar, { downloadText } from '@/bulk/components/PresetBar';
import SetupList from '@/bulk/components/SetupList';
import MonsterPicker from '@/bulk/components/MonsterPicker';
import BulkTable from '@/bulk/components/BulkTable';
import Panel, { buttonClass } from '@/bulk/components/Panel';

const BulkResults: React.FC<{ store: BulkStore; pool: BulkPool }> = observer(({ store, pool }) => {
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [running, setRunning] = useState(false);
  const [mode, setMode] = useState<Mode>('normal');
  const [sort, setSort] = useState<SortState>(defaultSort('normal'));
  const runToken = useRef(0);

  const preset = store.active;
  const setups = preset?.setups || [];
  const monster = preset?.monster || null;

  // results belong to one target and one set of setups: rerun whenever either changes (batched, so a burst of edits
  // runs once), and clear them when there is nothing to run
  useEffect(() => reaction(
    () => runKey(store.active),
    async (key) => {
      runToken.current += 1;
      const token = runToken.current;
      pool.cancel();
      const active = store.active;
      if (key === null || !active?.monster) {
        setRows([]);
        setProgress(null);
        setRunning(false);
        return;
      }

      setRunning(true);
      setRows([]);
      setProgress({ done: 0, total: active.setups.length });
      try {
        const result = await pool.run(toJS(active.setups), [toJS(active.monster)], (p) => {
          if (token !== runToken.current) return;
          setRows(p.rows);
          setProgress({ done: p.done, total: p.total });
        });
        if (token === runToken.current) setRows(result);
      } catch (e) {
        if (!(e instanceof Error && e.message === 'cancelled')) {
          toast.error(e instanceof Error ? e.message : 'Calculation failed');
        }
      } finally {
        if (token === runToken.current) setRunning(false);
      }
    },
    { fireImmediately: true, delay: 300 },
  ), [store, pool]);

  const visible = useMemo(() => selectRows(rows, { mode, sort }), [rows, mode, sort]);

  return (
    <Panel
      title={monster ? `Results vs ${monsterLabel(monster)}` : 'Results'}
      actions={(
        <>
          {running && (
            <button type="button" className={`${buttonClass} font-bold`} onClick={() => pool.cancel()}>
              <span className="flex items-center gap-1">
                <IconPlayerStop size={16} />
                {' '}
                Cancel
              </span>
            </button>
          )}
          <div className="flex rounded overflow-hidden border border-body-500 dark:border-dark-200">
            {(['normal', 'spec'] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`px-2.5 py-1 ${mode === m ? 'bg-orange-400 dark:bg-orange-700 text-white' : 'bg-btns-400 dark:bg-dark-500 text-gray-200'}`}
                onClick={() => {
                  setMode(m);
                  setSort(defaultSort(m));
                }}
              >
                {m === 'normal' ? 'Normal' : 'Spec'}
              </button>
            ))}
          </div>
          <button
            type="button"
            className={buttonClass}
            disabled={visible.length === 0}
            onClick={() => downloadText(
              `${preset?.name || 'bulk'}${monster ? ` vs ${monsterLabel(monster)}` : ''}-results.csv`,
              rowsToCsv(visible, setups),
              'text/csv',
            )}
          >
            <span className="flex items-center gap-1">
              <IconFileExport size={16} />
              {' '}
              CSV
            </span>
          </button>
        </>
      )}
    >
      {!running && progress && progress.done < progress.total && (
        <p className="px-4 py-2 text-sm text-gray-500 dark:text-gray-300">
          {`Stopped after ${progress.done} of ${progress.total} results.`}
        </p>
      )}
      {running && progress && (
        <div className="px-4 py-2 text-sm flex items-center gap-2">
          <div className="grow h-2 rounded bg-body-200 dark:bg-dark-500 overflow-hidden">
            <div className="h-full bg-orange-400 dark:bg-orange-600 transition-all" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          </div>
          <span className="tabular-nums">{`${progress.done} / ${progress.total}`}</span>
        </div>
      )}
      {store.canRun.ok ? (
        <div className="overflow-x-auto max-w-[100vw]">
          <BulkTable rows={visible} setups={setups} mode={mode} sort={sort} onSort={setSort} hasRun={!!progress && !running} />
        </div>
      ) : (
        <p className="px-4 py-6 text-center text-gray-500 dark:text-gray-300">{store.canRun.reason}</p>
      )}
    </Panel>
  );
});

const BulkPage: React.FC = observer(() => {
  const [store] = useState(() => new BulkStore());
  const [pool] = useState(() => new BulkPool({ createWorker: createBulkWorker }));

  useEffect(() => {
    store.load().catch(console.error);
    return () => pool.shutdown();
  }, [store, pool]);

  return (
    <BulkStoreContext.Provider value={store}>
      <div className="max-w-[1420px] mx-auto mt-4 mb-8 px-2 flex flex-col gap-3">
        {store.loaded ? (
          <>
            <PresetBar />
            <div className="flex gap-3 flex-wrap">
              <SetupList />
              <MonsterPicker />
            </div>
            <BulkResults store={store} pool={pool} />
          </>
        ) : (
          <p className="text-white text-sm">Loading presets...</p>
        )}
      </div>
    </BulkStoreContext.Provider>
  );
});

export default BulkPage;
