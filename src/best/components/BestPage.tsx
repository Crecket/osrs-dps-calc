'use client';

import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { IconAlertTriangle } from '@tabler/icons-react';
import { BestStore, BestStoreContext } from '@/best/state/BestStore';
import { BestPayload, BestResult } from '@/best/worker/protocol';
import createBestWorker from '@/best/worker/createBestWorker';
import { TaskPool } from '@/bulk/worker/TaskPool';
import { BulkPool } from '@/bulk/worker/BulkPool';
import createBulkWorker from '@/bulk/worker/createBulkWorker';
import TargetMonster from '@/bulk/components/TargetMonster';
import InputsPanel from '@/best/components/InputsPanel';
import BestResults, { Pools } from '@/best/components/BestResults';

const BestPage: React.FC = observer(() => {
  const [store] = useState(() => new BestStore());
  const [pools] = useState<Pools>(() => ({
    // a search chunk can take seconds, so Stop and a new run don't wait for it
    search: new TaskPool<BestPayload, BestResult>({ createWorker: createBestWorker, terminateOnCancel: true }),
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
          <div role="alert" className="flex items-start gap-2 px-4 py-2 rounded bg-orange-100 dark:bg-orange-500/60 text-orange-500 dark:text-orange-100 text-sm border border-orange-200 dark:border-orange-400">
            <IconAlertTriangle size={18} className="shrink-0 mt-px" aria-hidden />
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
          <p className="text-white text-sm">Loading your saved settings...</p>
        )}
      </div>
    </BestStoreContext.Provider>
  );
});

export default BestPage;
