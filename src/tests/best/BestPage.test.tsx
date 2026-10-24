import {
  afterEach, beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { StyleOutcome } from '@/best/lib/run';
import type { BestInputs } from '@/best/types';
import type { BulkPreset } from '@/bulk/types';

// in-memory storage for both the best and the bulk store; a key in mockFailing makes reads of it throw
const mockData = new Map<string, unknown>();
const mockFailing = new Set<string>();
jest.mock('localforage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (mockFailing.has(key)) throw new Error('read failed');
      return mockData.get(key) ?? null;
    },
    setItem: async (key: string, value: unknown) => {
      mockData.set(key, JSON.parse(JSON.stringify(value)));
      return value;
    },
  },
}));

const mockRun = jest.fn<(inputs: BestInputs) => Promise<StyleOutcome[]>>();
jest.mock('@/best/lib/run', () => ({ runBestSetup: (inputs: BestInputs) => mockRun(inputs) }));

const mockToast = { success: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('react-toastify', () => ({ toast: mockToast, ToastContainer: () => null }));

// the pools never get a run (runBestSetup is mocked), and the worker files use import.meta
jest.mock('@/best/worker/createBestWorker', () => ({ __esModule: true, default: () => { throw new Error('no workers'); } }));
jest.mock('@/bulk/worker/createBulkWorker', () => ({ __esModule: true, default: () => { throw new Error('no workers'); } }));
jest.mock('@/bulk/components/TargetMonster', () => ({ __esModule: true, default: () => null }));

// required after the mocks are registered (jest.mock from @jest/globals isn't hoisted above imports), so that every store
// gets the in-memory storage
/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const BestPage = require('@/best/components/BestPage').default as React.FC;
const { BEST_STORAGE_KEY } = require('@/best/state/BestStore') as typeof import('@/best/state/BestStore');
const { STORAGE_KEY } = require('@/bulk/state/BulkStore') as typeof import('@/bulk/state/BulkStore');
const { monsterFromSearch } = require('@/bulk/lib/presetIO') as typeof import('@/bulk/lib/presetIO');
const { getMonsters } = require('@/lib/Monsters') as typeof import('@/lib/Monsters');
const { generateEmptyPlayer } = require('@/state') as typeof import('@/state');
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

const outcome = (name: string): StyleOutcome => ({
  style: 'slash',
  setups: [{ id: 'best-slash-0', name, player: generateEmptyPlayer(name) }],
  rows: [{
    setupId: 'best-slash-0', monsterId: 'm', maxHit: 40, accuracy: 0.8, dps: 7.5, ttk: 30, spec: null, issues: [],
  }],
  approximate: false,
  message: null,
});

const mount = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  await act(async () => {
    root = createRoot(container);
    root.render(<BestPage />);
  });
  return { container, unmount: () => act(() => root.unmount()) };
};

const setNumber = (input: HTMLInputElement, value: string) => act(() => {
  // React tracks the value itself, so set it through the native setter for the change to register
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
});

describe('BestPage', () => {
  beforeEach(() => {
    // upstream's import logs every loadout the bulk store's default preset is made from
    jest.spyOn(console, 'debug').mockImplementation(() => {});
    mockData.clear();
    mockFailing.clear();
    mockData.set(BEST_STORAGE_KEY, { monster: monsterFromSearch(getMonsters().find((m) => m.id === 415)!) });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('runs once the saved state is loaded, and adds a result to the bulk preset', async () => {
    mockRun.mockResolvedValue([outcome('Whip')]);
    const { container, unmount } = await mount();
    await wait(10);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Slash');
    expect(container.textContent).toContain('Whip');
    expect(container.textContent).toContain('7.500');

    const add = [...container.querySelectorAll('button')].find((b) => b.textContent?.includes('Add to bulk preset'))!;
    await act(async () => add.click());
    await wait(10);
    const saved = mockData.get(STORAGE_KEY) as { presets: BulkPreset[]; activeId: string };
    const active = saved.presets.find((p) => p.id === saved.activeId)!;
    expect(active.setups.map((s) => s.name)).toContain('Whip');
    expect(active.setups.find((s) => s.name === 'Whip')!.id).not.toBe('best-slash-0');
    expect(mockToast.success).toHaveBeenCalledWith(`Added to ${active.name}`);

    // the same setup again is a duplicate
    await act(async () => add.click());
    await wait(10);
    expect(mockToast.info).toHaveBeenCalledWith(`That setup is already in ${active.name}`);
    await unmount();
  });

  test('an input change mid-run restarts without the old results or a cancelled error', async () => {
    let rejectFirst: (e: Error) => void = () => {};
    mockRun.mockImplementationOnce(() => new Promise((_, reject) => { rejectFirst = reject; }));
    const { container, unmount } = await mount();
    await wait(10);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Searching...');

    // the real runBestSetup rejects the older run when a newer one starts
    mockRun.mockImplementationOnce(async () => {
      rejectFirst(new Error('cancelled'));
      return [outcome('Rapier')];
    });
    const attack = container.querySelector<HTMLInputElement>('input[type=number]')!;
    await setNumber(attack, '8');
    await setNumber(attack, '80');
    // debounced: typing a level runs once, with the final value
    await wait(100);
    expect(mockRun).toHaveBeenCalledTimes(1);
    await wait(400);

    expect(mockRun).toHaveBeenCalledTimes(2);
    expect(mockRun.mock.calls[1][0].skills.atk).toBe(80);
    expect(container.textContent).toContain('Rapier');
    expect(container.textContent).not.toContain('Searching...');
    expect(mockToast.error).not.toHaveBeenCalled();
    await unmount();
  });

  test('warns when the saved settings could not be read', async () => {
    mockFailing.add(BEST_STORAGE_KEY);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockRun.mockResolvedValue([]);
    const { container, unmount } = await mount();
    expect(container.textContent).toContain('Saved best setup settings could not be read');
    expect(warn).toHaveBeenCalled();
    // nothing to run against: the saved monster was never read
    await wait(400);
    expect(mockRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Pick a monster');
    await unmount();
  });
});
