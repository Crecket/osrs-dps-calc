import {
  afterEach, beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { StyleOutcome } from '@/best/lib/run';
import type { BestInputs } from '@/best/types';
import type { BulkPreset } from '@/bulk/types';
import { Prayer } from '@/enums/Prayer';

// in-memory storage for both the best and the bulk store; a key in mockFailing makes reads of it throw
const mockData = new Map<string, unknown>();
const mockFailing = new Set<string>();
const mockFailingWrites = new Set<string>();
jest.mock('localforage', () => ({
  __esModule: true,
  default: {
    getItem: async (key: string) => {
      if (mockFailing.has(key)) throw new Error('read failed');
      return mockData.get(key) ?? null;
    },
    setItem: async (key: string, value: unknown) => {
      if (mockFailingWrites.has(key)) throw new Error('write failed');
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
const { TaskPool } = require('@/bulk/worker/TaskPool') as typeof import('@/bulk/worker/TaskPool');
const { BulkPool } = require('@/bulk/worker/BulkPool') as typeof import('@/bulk/worker/BulkPool');
const { PRESETS_CHANNEL } = require('@/bulk/state/presetChannel') as typeof import('@/bulk/state/presetChannel');
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

// jsdom has no BroadcastChannel; record what is posted
const posted: [string, unknown][] = [];
class FakeChannel {
  constructor(public name: string) {}

  postMessage(m: unknown) { posted.push([this.name, m]); }

  // eslint-disable-next-line class-methods-use-this
  close() {}
}

const button = (container: HTMLElement, text: string) => [...container.querySelectorAll('button')]
  .find((b) => b.textContent?.includes(text));

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
    mockFailingWrites.clear();
    mockRun.mockReset();
    posted.length = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).BroadcastChannel = FakeChannel;
    mockData.set(BEST_STORAGE_KEY, { monster: monsterFromSearch(getMonsters().find((m) => m.id === 415)!) });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).BroadcastChannel;
  });

  const find = (container: HTMLElement) => button(container, 'Find best setup')!;

  test('nothing runs on load or on an input change; the button runs once', async () => {
    mockRun.mockResolvedValue([outcome('Whip')]);
    const { container, unmount } = await mount();
    await wait(400);
    expect(mockRun).not.toHaveBeenCalled();
    await setNumber(container.querySelector<HTMLInputElement>('input[type=number]')!, '80');
    await wait(400);
    expect(mockRun).not.toHaveBeenCalled();

    expect(find(container).disabled).toBe(false);
    await act(async () => find(container).click());
    await wait(10);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(mockRun.mock.calls[0][0].skills.atk).toBe(80);
    expect(container.textContent).toContain('Whip');
    await wait(400);
    expect(mockRun).toHaveBeenCalledTimes(1);
    await unmount();
  });

  test('an input change after a run keeps the results and marks them out of date', async () => {
    mockRun.mockResolvedValue([outcome('Whip')]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);
    expect(container.textContent).not.toContain('out of date');

    const attack = container.querySelector<HTMLInputElement>('input[type=number]')!;
    const before = attack.value;
    await setNumber(attack, '80');
    await wait(400);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Whip');
    expect(container.textContent).toContain('Inputs changed — results are out of date');

    // back to the searched inputs: the results are current again
    await setNumber(attack, before);
    expect(container.textContent).not.toContain('out of date');
    await unmount();
  });

  test('adds a result to the bulk preset', async () => {
    mockRun.mockResolvedValue([outcome('Whip')]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);
    expect(container.textContent).toContain('Slash');
    expect(container.textContent).toContain('Whip');
    expect(container.textContent).toContain('7.500');

    const add = button(container, 'Add to bulk preset')!;
    await act(async () => add.click());
    await wait(10);
    const saved = mockData.get(STORAGE_KEY) as { presets: BulkPreset[]; activeId: string };
    const active = saved.presets.find((p) => p.id === saved.activeId)!;
    expect(active.setups.map((s) => s.name)).toContain('Whip');
    expect(active.setups.find((s) => s.name === 'Whip')!.id).not.toBe('best-slash-0');
    expect(mockToast.success).toHaveBeenCalledWith(`Added to ${active.name}`);
    // open bulk tool tabs reload their presets
    expect(posted).toEqual([[PRESETS_CHANNEL, 'changed']]);

    // the same setup again is a duplicate
    await act(async () => add.click());
    await wait(10);
    expect(mockToast.info).toHaveBeenCalledWith(`That setup is already in ${active.name}`);
    await unmount();
  });

  test('a failed save of the bulk presets is an error, not a success', async () => {
    mockRun.mockResolvedValue([outcome('Whip')]);
    mockFailingWrites.add(STORAGE_KEY);
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);
    await act(async () => button(container, 'Add to bulk preset')!.click());
    await wait(10);
    expect(mockToast.success).not.toHaveBeenCalled();
    expect(mockToast.error).toHaveBeenCalledWith('Could not save the bulk tool\'s presets');
    expect(posted).toEqual([]);
    expect(error).toHaveBeenCalled();
    await unmount();
  });

  test('Stop cancels the run and ignores the stopped run\'s result', async () => {
    let resolveFirst: (o: StyleOutcome[]) => void = () => {};
    mockRun.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    const searchCancel = jest.spyOn(TaskPool.prototype, 'cancel');
    const rowsCancel = jest.spyOn(BulkPool.prototype, 'cancel');
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Searching...');
    expect(find(container)).toBeUndefined();

    await act(async () => button(container, 'Stop')!.click());
    expect(searchCancel).toHaveBeenCalled();
    expect(rowsCancel).toHaveBeenCalled();
    expect(container.textContent).toContain('Search stopped');

    await act(async () => resolveFirst([outcome('Late')]));
    await wait(10);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain('Late');
    await unmount();
  });

  test('an older run that resolves late doesn\'t replace the newer results', async () => {
    let resolveFirst: (o: StyleOutcome[]) => void = () => {};
    mockRun.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    mockRun.mockImplementationOnce(async () => [outcome('New')]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await act(async () => button(container, 'Stop')!.click());
    await act(async () => find(container).click());
    await wait(10);
    expect(container.textContent).toContain('New');

    await act(async () => resolveFirst([outcome('Old')]));
    await wait(10);
    expect(container.textContent).toContain('New');
    expect(container.textContent).not.toContain('Old');
    await unmount();
  });

  test('the prayer Auto label shows the prayers bestPrayers picks, and follows the Prayer level', async () => {
    const { container, unmount } = await mount();
    const melee = () => [...container.querySelectorAll('select')].find((sel) => sel.options[0].text.startsWith('Auto'))!;
    const prayerLevel = [...container.querySelectorAll('label')].find((l) => l.querySelector('span')?.textContent === 'Prayer')!
      .querySelector('input')!;
    expect(melee().options[0].text).toBe('Auto — Zeal');

    await setNumber(prayerLevel, '31');
    expect(melee().options[0].text).toBe('Auto — Ultimate Strength + Improved Reflexes');
    expect([...melee().options].map((o) => o.text)).toContain('Burst of Strength');
    // Piety's unlock note
    expect(container.textContent).toContain('Chivalry needs 60 Prayer, 65 Defence');

    // choosing a prayer saves an override, and nothing runs
    await act(async () => {
      melee().value = String(Prayer.SUPERHUMAN_STRENGTH);
      melee().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(10);
    expect((mockData.get(BEST_STORAGE_KEY) as { inputs: BestInputs }).inputs.prayerOverrides).toEqual({ melee: [Prayer.SUPERHUMAN_STRENGTH] });
    expect(mockRun).not.toHaveBeenCalled();

    // an override the levels no longer allow falls back to Auto, with a note
    await setNumber(prayerLevel, '10');
    expect(container.textContent).toContain("Superhuman Strength isn't usable at these levels, so Auto is used");
    expect(melee().value).toBe('auto');
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
    expect(find(container).disabled).toBe(true);
    await act(async () => find(container).click());
    expect(mockRun).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Pick a monster');
    await unmount();
  });
});
