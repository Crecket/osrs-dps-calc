import {
  afterEach, beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { availableEquipment } from '@/lib/Equipment';
import { createEmptyPlayer } from '@/state/PlayerStore';
import { defaultSort, selectRows } from '@/bulk/lib/table';
import type { SetupCost } from '@/bulk/lib/cost';
import { BulkRow, BulkSetup } from '@/bulk/types';
import { Player } from '@/types/Player';

const mockCache = new Map<string, unknown>();
jest.mock('localforage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockCache.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      mockCache.set(key, value);
      return value;
    },
  },
}));

// required after the mock is registered (jest.mock from @jest/globals isn't hoisted above imports)
/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const { setupCost } = require('@/bulk/lib/cost') as typeof import('@/bulk/lib/cost');
const BulkTable = require('@/bulk/components/BulkTable').default as typeof import('@/bulk/components/BulkTable').default;
const useIdlePrices = require('@/bulk/lib/useIdlePrices').default as typeof import('@/bulk/lib/useIdlePrices').default;
const { PRICE_CACHE_KEY } = require('@/raid/lib/prices') as typeof import('@/raid/lib/prices');
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const named = (name: string) => availableEquipment.find((e) => e.name === name)!;
const wearing = (equipment: Partial<Player['equipment']>): Player => {
  const player = createEmptyPlayer('x');
  return { ...player, equipment: { ...player.equipment, ...equipment } };
};
const row = (setupId: string, over: Partial<BulkRow> = {}): BulkRow => ({
  setupId, monsterId: 'm', maxHit: 10, accuracy: 0.5, dps: 1, ttk: 60, spec: null, issues: [], ...over,
});

describe('setupCost', () => {
  const prices = { byId: new Map([[named('Abyssal whip').id, 2e6], [22983, 3e6]]), byName: new Map() };

  test('adds up the worn items, an untradeable one priced from its parts', () => {
    const cost = setupCost(wearing({ weapon: named('Abyssal whip'), hands: named('Ferocious gloves') }), prices);
    expect(cost).toEqual({ total: 5e6, unpriced: [] });
  });

  test('names what it can\'t price', () => {
    const cost = setupCost(wearing({ weapon: named('Abyssal whip'), cape: named('Fire cape') }), prices);
    expect(cost).toEqual({ total: 2e6, unpriced: ['Fire cape'] });
  });

  test('has no answer without prices, rather than saying 0', () => {
    const player = wearing({ weapon: named('Abyssal whip') });
    expect(setupCost(player, null)).toBeNull();
    expect(setupCost(player, { byId: new Map(), byName: new Map() })).toBeNull();
  });
});

describe('sorting by cost', () => {
  const costs = new Map<string, SetupCost>([['cheap', { total: 5, unpriced: [] }], ['dear', { total: 50, unpriced: [] }]]);
  const rows = [row('none'), row('dear'), row('cheap')];

  test('sorts both ways, with unknown costs last', () => {
    const ids = (dir: 'asc' | 'desc') => selectRows(rows, { mode: 'normal', sort: { key: 'cost', dir }, costs }).map((r) => r.setupId);
    expect(ids('asc')).toEqual(['cheap', 'dear', 'none']);
    expect(ids('desc')).toEqual(['dear', 'cheap', 'none']);
  });
});

describe('the cost column', () => {
  let container: HTMLDivElement;
  let root: Root;
  const setups: BulkSetup[] = ['a', 'bad'].map((id) => ({ id, name: id, player: createEmptyPlayer(id) }));
  const render = (costs?: Map<string, SetupCost> | null) => act(() => {
    root.render(
      <BulkTable
        rows={[row('a'), row('bad', { error: 'boom' })]}
        setups={setups}
        mode="normal"
        sort={defaultSort('normal')}
        onSort={() => {}}
        hasRun
        costs={costs}
      />,
    );
  });
  const header = () => [...container.querySelectorAll('th')].find((h) => h.textContent === 'Cost');
  const lastValue = (i: number) => {
    const cells = container.querySelectorAll('tbody tr')[i].children;
    return cells[cells.length - 2].textContent;
  };

  beforeEach(() => {
    container = document.createElement('div');
    root = createRoot(container);
  });

  afterEach(() => act(() => root.unmount()));

  test('is left out where costs aren\'t asked for', () => {
    render();
    expect(header()).toBeUndefined();
  });

  test('shows a dash, and can\'t be sorted, without prices', () => {
    render(null);
    expect(header()?.querySelector('button')).toBeNull();
    expect(lastValue(0)).toBe('—');
    expect(lastValue(1)).toBe('—');
  });

  test('shows the cost, also for a row whose calculation failed', () => {
    render(new Map([['a', { total: 2_500_000, unpriced: [] }], ['bad', { total: 0, unpriced: ['Fire cape'] }]]));
    expect(header()?.querySelector('button')).not.toBeNull();
    expect(lastValue(0)).toBe('2.5m');
    expect(lastValue(1)).toBe('0');
    const cells = container.querySelectorAll('tbody tr')[1].children;
    expect(cells[cells.length - 2].getAttribute('data-tooltip-content')).toContain('Fire cape');
  });
});

describe('useIdlePrices', () => {
  const Probe: React.FC<{ onPrices: (n: number | null) => void }> = ({ onPrices }) => {
    const prices = useIdlePrices();
    onPrices(prices?.byId.size ?? null);
    return null;
  };
  const originalFetch = globalThis.fetch;
  let fetchMock: jest.Mock<typeof fetch>;
  let root: Root;
  let seen: (number | null)[];

  const mount = () => act(async () => {
    root = createRoot(document.createElement('div'));
    root.render(<Probe onPrices={(n) => seen.push(n)} />);
  });
  const settle = () => act(async () => { await jest.advanceTimersByTimeAsync(1000); });

  beforeEach(() => {
    jest.useFakeTimers();
    mockCache.clear();
    seen = [];
    fetchMock = jest.fn<typeof fetch>();
    globalThis.fetch = fetchMock;
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    jest.useRealTimers();
    globalThis.fetch = originalFetch;
  });

  test('uses the raid page\'s snapshot, however old, without refreshing it', async () => {
    const snapshot = { at: 1, mapping: [{ id: 1, name: 'A' }], latest: { data: { 1: { high: 10, low: 8 } } } };
    mockCache.set(PRICE_CACHE_KEY, snapshot);
    await mount();
    expect(seen.at(-1)).toBeNull();
    await settle();

    expect(seen.at(-1)).toBe(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockCache.get(PRICE_CACHE_KEY)).toBe(snapshot);
  });

  test('doesn\'t fetch while the page is loading', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await mount();
    expect(fetchMock).not.toHaveBeenCalled();
    await settle();
    expect(fetchMock).toHaveBeenCalled();
  });

  test('stays without prices when they can\'t be fetched', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    await mount();
    await settle();
    expect(seen.at(-1)).toBeNull();
  });
});
