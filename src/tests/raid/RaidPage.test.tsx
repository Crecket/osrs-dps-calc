import {
  afterEach, beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { RaidResult, RaidSettings } from '@/raid/lib/runRaid';
import type { RaidProgress } from '@/raid/lib/candidates';

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

type Run = (settings: RaidSettings, onProgress: (p: RaidProgress) => void) => Promise<RaidResult>;
const mockRunRaid = jest.fn<Run>();
const mockNeeded = jest.fn<() => number>();
jest.mock('@/raid/lib/runRaid', () => {
  const actual = jest.requireActual('@/raid/lib/runRaid') as object;
  return {
    ...actual,
    runRaid: (settings: RaidSettings, _p: unknown, _d: unknown, onProgress: (p: RaidProgress) => void) => mockRunRaid(settings, onProgress),
    searchesNeeded: () => mockNeeded(),
  };
});
jest.mock('@/raid/lib/prices', () => {
  const actual = jest.requireActual('@/raid/lib/prices') as object;
  return { ...actual, fetchPrices: async () => null };
});
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), info: jest.fn(), error: jest.fn() }, ToastContainer: () => null }));
jest.mock('@/best/worker/createBestWorker', () => ({ __esModule: true, default: () => { throw new Error('no workers'); } }));
jest.mock('@/bulk/worker/createBulkWorker', () => ({ __esModule: true, default: () => { throw new Error('no workers'); } }));

// required after the mocks are registered (jest.mock from @jest/globals isn't hoisted above imports)
/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const RaidPage = require('@/raid/components/RaidPage').default as React.FC;
const { layoutLoadout } = require('@/raid/lib/layout') as typeof import('@/raid/lib/layout');
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

const result = (settings: RaidSettings): RaidResult => ({
  plan: {
    itemIds: [20997, 4151], cost: 1e9, totalSeconds: 600, picks: [{ key: 'bork:0', candidate: null, seconds: 600 }], overBudget: false, main: null,
  },
  layout: layoutLoadout([20997, 4151], null, settings.supplies, settings.magic),
  phases: [{
    key: 'bork:0', label: 'Bork', bossId: 'bork', bossName: 'Bork', hp: 1500, counts: { elderMaul: 2, dwh: 0, tonalztic: 0 },
  }],
  options: { 'bork:0': [{ weaponId: 20997, dps: 10, seconds: 150 }, { weaponId: 4151, dps: 5, seconds: 300 }] },
});

const mount = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<RaidPage />);
  });
  await wait(50);
  return { container, unmount: () => act(() => root.unmount()) };
};

const button = (c: HTMLElement, text: string) => [...c.querySelectorAll('button')].find((b) => b.textContent?.includes(text));
const select = (c: HTMLElement, id: string) => c.querySelector<HTMLSelectElement>(`#${id}`)!;
const change = (el: HTMLInputElement | HTMLSelectElement, value: string) => act(() => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
});

describe('RaidPage', () => {
  beforeEach(() => {
    mockData.clear();
    mockRunRaid.mockReset();
    mockNeeded.mockReset();
    mockNeeded.mockReturnValue(18);
    mockRunRaid.mockImplementation(async (settings) => result(settings));
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('nothing runs until the button; then grids and boss rows render', async () => {
    const { container, unmount } = await mount();
    expect(select(container, 'stop-second')).toBeTruthy();
    expect(container.textContent).toContain('18 searches to run');
    expect(mockRunRaid).not.toHaveBeenCalled();
    await act(async () => button(container, 'Find raid gear')!.click());
    await wait(20);
    expect(mockRunRaid).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-testid=inv-cell]')).toHaveLength(28);
    expect(container.querySelector('[data-testid=equipment-grid]')).toBeTruthy();
    expect(container.querySelectorAll('[data-testid=boss-row]')).toHaveLength(1);
    expect(container.textContent).toContain('10.00');
    await unmount();
  });

  test('a change that needs searches marks the result stale', async () => {
    const { container, unmount } = await mount();
    await act(async () => button(container, 'Find raid gear')!.click());
    await wait(20);
    await change(container.querySelector<HTMLInputElement>('#raid-budget')!, '4b');
    await wait(20);
    expect(container.textContent).toContain('Inputs changed');
    expect(mockRunRaid).toHaveBeenCalledTimes(1);
    await unmount();
  });

  test('changing brews re-plans without the button when nothing needs searching', async () => {
    const { container, unmount } = await mount();
    await act(async () => button(container, 'Find raid gear')!.click());
    await wait(20);
    mockNeeded.mockReturnValue(0);
    const brews = [...container.querySelectorAll<HTMLInputElement>('input[type=number]')]
      .find((i) => i.value === '6')!;
    await change(brews, '8');
    await wait(50);
    expect(mockRunRaid).toHaveBeenCalledTimes(2);
    expect(mockRunRaid.mock.calls[1][0].supplies.brews).toBe(8);
    expect(container.textContent).not.toContain('Inputs changed');
    await unmount();
  });

  test('progress bars follow the run', async () => {
    let finish: () => void = () => {};
    mockRunRaid.mockImplementation((settings, onProgress) => new Promise((resolve) => {
      onProgress({
        search: 3, searches: 18, phaseLabel: 'Ocellus — Phase 2', inner: { done: 5, total: 10, phase: 'descent' }, cached: 6,
      });
      finish = () => resolve(result(settings));
    }));
    const { container, unmount } = await mount();
    await act(async () => button(container, 'Find raid gear')!.click());
    await wait(20);
    expect(container.textContent).toContain('Search 4 of 18 — Ocellus — Phase 2 (6 cached)');
    const bars = container.querySelectorAll('[role=progressbar]');
    expect(bars).toHaveLength(2);
    expect(bars[1].getAttribute('aria-valuenow')).toBe('50');
    await act(async () => finish());
    await unmount();
  });

  test('thralls through Dagon\'hai disable the button', async () => {
    const { container, unmount } = await mount();
    await change(select(container, 'stop-fourth'), 'dagonhai');
    expect(button(container, 'Find raid gear')!.disabled).toBe(true);
    expect(container.textContent).toContain('need elemental spells');
    await change(select(container, 'raid-magic'), 'standard');
    expect(button(container, 'Find raid gear')!.disabled).toBe(false);
    await unmount();
  });

  test('the last result shows again after a reload', async () => {
    const first = await mount();
    await act(async () => button(first.container, 'Find raid gear')!.click());
    await wait(20);
    await first.unmount();
    const { container, unmount } = await mount();
    expect(container.querySelectorAll('[data-testid=inv-cell]')).toHaveLength(28);
    expect(container.textContent).not.toContain('Inputs changed');
    await unmount();
  });
});
