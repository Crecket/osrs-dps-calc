import { useEffect, useState } from 'react';
import { GlobalState } from '@/state';
import { useBulkStore } from '@/bulk/state/BulkStore';
import SetupSync from '@/bulk/state/SetupSync';

/**
 * A private calculator store bound to one setup, for rendering upstream's player controls against it.
 */
const useSetupStore = (setupId: string): GlobalState => {
  const bulk = useBulkStore();
  const [calc] = useState(() => new GlobalState());

  useEffect(() => {
    const sync = new SetupSync(bulk, calc, setupId);
    sync.start();
    return () => sync.dispose();
  }, [bulk, calc, setupId]);

  return calc;
};

export default useSetupStore;
