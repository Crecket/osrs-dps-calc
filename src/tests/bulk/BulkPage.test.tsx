import {
  afterEach, beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

const STORAGE_KEY = 'dps-bulk-presets';
const mockData = new Map<string, unknown>();
jest.mock('localforage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => mockData.get(key) ?? null,
    setItem: async (key: string, value: unknown) => {
      mockData.set(key, JSON.parse(JSON.stringify(value)));
      return value;
    },
  },
}));
jest.mock('@/bulk/worker/createBulkWorker', () => ({ __esModule: true, default: () => { throw new Error('no workers'); } }));

// required after the mocks are registered (jest.mock from @jest/globals isn't hoisted above imports)
// eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
const BulkPage = require('@/bulk/components/BulkPage').default as React.FC;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// the first load creates the first preset: a change still waiting to be written
const mount = async () => {
  const container = document.createElement('div');
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<BulkPage />);
  });
  // lets the load finish; the waiting write stays waiting, however long rendering takes, as the clock is fake
  await act(async () => { await jest.advanceTimersByTimeAsync(1); });
  return { unmount: () => act(() => root.unmount()) };
};

describe('BulkPage', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockData.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a closing page writes the change still waiting', async () => {
    const { unmount } = await mount();
    expect(mockData.has(STORAGE_KEY)).toBe(false);
    window.dispatchEvent(new Event('pagehide'));
    expect(mockData.has(STORAGE_KEY)).toBe(true);
    await unmount();
  });

  test('leaving the page writes the change still waiting', async () => {
    const { unmount } = await mount();
    expect(mockData.has(STORAGE_KEY)).toBe(false);
    await unmount();
    expect(mockData.has(STORAGE_KEY)).toBe(true);
  });
});
