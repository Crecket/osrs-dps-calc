import { useEffect, useState } from 'react';
import { fetchPrices, Prices } from '@/raid/lib/prices';

const IDLE_TIMEOUT = 2000;
// browsers without requestIdleCallback
const FALLBACK_DELAY = 200;

/**
 * Prices, loaded once the page has nothing better to do, as reading them means parsing a large snapshot on the main thread.
 * Null until then and when there are none. This is the raid page's snapshot, however old: refreshing it from here would
 * make the raid page redo its cached searches, so only the raid page's refresh button does that.
 */
const useIdlePrices = (): Prices | null => {
  const [prices, setPrices] = useState<Prices | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchPrices(undefined, Date.now(), Infinity).catch(() => null).then((p) => {
        if (!cancelled) setPrices(p);
      });
    };
    if (typeof window.requestIdleCallback === 'function') {
      const handle = window.requestIdleCallback(load, { timeout: IDLE_TIMEOUT });
      return () => {
        cancelled = true;
        window.cancelIdleCallback(handle);
      };
    }
    const timer = setTimeout(load, FALLBACK_DELAY);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return prices;
};

export default useIdlePrices;
