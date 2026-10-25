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

type Progress = (done: number, total: number, phase: string) => void;
const mockRun = jest.fn<(inputs: BestInputs, onProgress: Progress) => Promise<StyleOutcome[]>>();
jest.mock('@/best/lib/run', () => ({
  runBestSetup: (inputs: BestInputs, _monster: unknown, _deps: unknown, onProgress: Progress) => mockRun(inputs, onProgress),
}));

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
const { availableEquipment } = require('@/lib/Equipment') as typeof import('@/lib/Equipment');
const { generateEmptyPlayer } = require('@/state') as typeof import('@/state');
const { TaskPool } = require('@/bulk/worker/TaskPool') as typeof import('@/bulk/worker/TaskPool');
const { BulkPool } = require('@/bulk/worker/BulkPool') as typeof import('@/bulk/worker/BulkPool');
const { PRESETS_CHANNEL } = require('@/bulk/state/presetChannel') as typeof import('@/bulk/state/presetChannel');
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const wait = (ms: number) => act(() => new Promise<void>((r) => { setTimeout(r, ms); }));

// results show no setup names, so tests tell outcomes apart by their DPS
const outcome = (name: string, dps = 7.5): StyleOutcome => ({
  style: 'slash',
  setups: [{ id: 'best-slash-0', name, player: generateEmptyPlayer(name) }],
  rows: [{
    setupId: 'best-slash-0', monsterId: 'm', maxHit: 40, accuracy: 0.8, dps, ttk: 30, spec: null, issues: [],
  }],
  approximate: false,
  message: null,
  variants: {},
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

// by its text, or an icon button by its label
const button = (container: HTMLElement, text: string) => [...container.querySelectorAll('button')]
  .find((b) => b.textContent?.includes(text) || b.getAttribute('aria-label') === text);

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
    expect(container.textContent).toContain('7.500');
    await wait(400);
    expect(mockRun).toHaveBeenCalledTimes(1);
    await unmount();
  });

  test('an input change after a run keeps the results and marks them out of date', async () => {
    mockRun.mockResolvedValue([outcome('Whip')]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);
    expect(container.textContent).not.toContain('Inputs changed since this search');

    const attack = container.querySelector<HTMLInputElement>('input[type=number]')!;
    const before = attack.value;
    await setNumber(attack, '80');
    await wait(400);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('7.500');
    expect(container.textContent).toContain('Inputs changed since this search');

    // back to the searched inputs: the results are current again
    await setNumber(attack, before);
    expect(container.textContent).not.toContain('Inputs changed since this search');
    await unmount();
  });

  test('adds a result to the bulk preset', async () => {
    mockRun.mockResolvedValue([outcome('Whip')]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);
    expect(container.textContent).toContain('Slash');
    expect(container.textContent).toContain('7.500');
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
    mockRun.mockImplementationOnce(async () => [outcome('New', 8)]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await act(async () => button(container, 'Stop')!.click());
    await act(async () => find(container).click());
    await wait(10);
    expect(container.textContent).toContain('8.000');

    await act(async () => resolveFirst([outcome('Old', 6)]));
    await wait(10);
    expect(container.textContent).toContain('8.000');
    expect(container.textContent).not.toContain('6.000');
    await unmount();
  });

  test('prayers: three rows with no unlock checkboxes; the Auto label follows the Prayer level', async () => {
    const { container, unmount } = await mount();
    const selects = () => [...container.querySelectorAll('select')].filter((sel) => sel.options[0].text.startsWith('Auto'));
    const melee = () => selects()[0];
    const prayerLabel = [...container.querySelectorAll('label')].find((l) => l.textContent === 'Prayer')!;
    const prayerLevel = container.querySelector<HTMLInputElement>(`[id="${prayerLabel.htmlFor}"]`)!;
    expect(selects().map((sel) => container.querySelector(`label[for="${sel.id}"]`)!.textContent)).toEqual(['Melee', 'Ranged', 'Magic']);
    expect(selects().map((sel) => sel.options[0].text)).toEqual(['Auto (Zeal)', 'Auto (Rigour)', 'Auto (Augury)']);
    const checkboxLabels = [...container.querySelectorAll('input[type=checkbox]')].map((c) => c.closest('label')!.textContent);
    ['Piety', 'Rigour', 'Augury', 'Deadeye', 'Mystic Vigour', 'Zeal'].forEach((p) => expect(checkboxLabels.join('|')).not.toContain(p));

    await setNumber(prayerLevel, '31');
    expect(melee().options[0].text).toBe('Auto (Ultimate Strength + Improved Reflexes)');
    const options = [...melee().options].map((o) => o.text);
    expect(options).toContain('Burst of Strength');
    // options the levels don't allow aren't listed
    expect(options).not.toContain('Piety');
    expect(options[options.length - 1]).toBe('None');

    // choosing a prayer saves an override, and nothing runs
    await act(async () => {
      melee().value = String(Prayer.SUPERHUMAN_STRENGTH);
      melee().dispatchEvent(new Event('change', { bubbles: true }));
    });
    await wait(10);
    expect((mockData.get(BEST_STORAGE_KEY) as { inputs: BestInputs }).inputs.prayerOverrides).toEqual({ melee: [Prayer.SUPERHUMAN_STRENGTH] });
    expect(mockRun).not.toHaveBeenCalled();

    // an override the levels no longer allow falls back to Auto, with one line
    await setNumber(prayerLevel, '10');
    expect(container.textContent).toContain('Superhuman Strength needs 13 Prayer, so Auto is used');
    expect(melee().value).toBe('auto');
    await unmount();
  });

  test('style chips sit by the button; changing them only marks results stale', async () => {
    mockRun.mockResolvedValue([outcome('Whip')]);
    const { container, unmount } = await mount();
    const chip = (name: string) => container.querySelector('[aria-label=Styles]')!.querySelector<HTMLButtonElement>(`button:nth-child(${['Stab', 'Slash', 'Crush', 'Ranged', 'Magic'].indexOf(name) + 1})`)!;
    expect(chip('Magic').textContent).toBe('Magic');
    await act(async () => find(container).click());
    await wait(10);
    await act(async () => chip('Magic').click());
    await wait(400);
    expect(chip('Magic').getAttribute('aria-pressed')).toBe('false');
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Inputs changed since this search');

    // the last style can't be turned off
    for (const n of ['Stab', 'Slash', 'Crush', 'Ranged']) {
      // eslint-disable-next-line no-await-in-loop
      await act(async () => chip(n).click());
    }
    expect(['Stab', 'Slash', 'Crush', 'Ranged', 'Magic'].filter((n) => chip(n).getAttribute('aria-pressed') === 'true')).toEqual(['Ranged']);
    expect(chip('Ranged').disabled).toBe(true);
    await act(async () => find(container).click());
    expect(mockRun.mock.calls[1][0].styles).toEqual(['ranged']);
    await unmount();
  });

  test('right-clicking an item in a result excludes it without running; the chip removes it again', async () => {
    const torture = availableEquipment.find((e) => e.name === 'Amulet of torture')!;
    const withNeck = outcome('Whip');
    withNeck.setups[0].player.equipment.neck = torture;
    mockRun.mockResolvedValue([withNeck]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);

    const cell = container.querySelector(`img[alt="${torture.name}"]`)!.closest('div')!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    await act(async () => { cell.dispatchEvent(event); });
    await wait(10);
    expect(event.defaultPrevented).toBe(true);
    expect((mockData.get(BEST_STORAGE_KEY) as { inputs: BestInputs }).inputs.excludedItemIds).toEqual([torture.id]);
    expect(mockToast.info).toHaveBeenCalledWith(`Excluded ${torture.name}. Click Find best setup to update the results.`);
    expect(mockRun).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('Inputs changed since this search');

    // the Excluded items chip, and its remove button
    const remove = container.querySelector<HTMLButtonElement>(`button[aria-label="Include ${torture.name} again"]`)!;
    await act(async () => remove.click());
    await wait(10);
    expect((mockData.get(BEST_STORAGE_KEY) as { inputs: BestInputs }).inputs.excludedItemIds).toEqual([]);
    expect(mockRun).toHaveBeenCalledTimes(1);
    await unmount();
  });

  test('right-clicking a weapon that stands for cosmetic variants excludes those copies too', async () => {
    const [scythe, holy, sanguine] = ['Scythe of Vitur', 'Holy Scythe of Vitur', 'Sanguine Scythe of Vitur']
      .map((name) => availableEquipment.find((e) => e.name === name && e.version === 'Charged')!);
    const withWeapon = outcome('Scythe of Vitur (Chop) — or Holy Scythe of Vitur, Sanguine Scythe of Vitur');
    withWeapon.setups[0].player.equipment.weapon = scythe;
    // a weapon that only calculates the same isn't a copy, so it stays
    const rapier = availableEquipment.find((e) => e.name === 'Ghrazi rapier')!;
    withWeapon.variants = { [scythe.id]: [holy.id, sanguine.id, rapier.id] };
    mockRun.mockResolvedValue([withWeapon]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);

    const cell = container.querySelector(`img[alt="${scythe.name}"]`)!.closest('div')!;
    await act(async () => { cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })); });
    await wait(10);
    expect((mockData.get(BEST_STORAGE_KEY) as { inputs: BestInputs }).inputs.excludedItemIds).toEqual([scythe.id, holy.id, sanguine.id]);
    expect(mockToast.info).toHaveBeenCalledWith(`Excluded ${scythe.name}, ${holy.name} and ${sanguine.name}. Click Find best setup to update the results.`);
    expect(mockRun).toHaveBeenCalledTimes(1);
    await unmount();
  });

  test('before the first run, points at the button', async () => {
    const { container, unmount } = await mount();
    expect(container.querySelector('[role="note"]')!.textContent).toContain('Experimental');
    expect(container.textContent).toContain('Click Find best setup to search.');
    await unmount();
  });

  test('while running, shows the phase and percentage; a failed search says so where the results go', async () => {
    let fail: (e: Error) => void = () => {};
    mockRun.mockImplementationOnce((_inputs, onProgress) => new Promise((_resolve, reject) => {
      onProgress(30, 120, 'descent');
      fail = reject;
    }));
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    expect(container.textContent).toContain('Trying every weapon');
    expect(container.textContent).toContain('25%');

    await act(async () => fail(new Error('worker crashed')));
    await wait(10);
    expect(container.textContent).toContain('The search failed: worker crashed. Click Find best setup to try again.');
    expect(container.textContent).not.toContain('Trying every weapon');
    await unmount();
  });

  test('the best DPS setup is marked; each weapon ranks once, its other setups fold under it', async () => {
    const [whip, rapier] = ['Abyssal whip', 'Ghrazi rapier'].map((name) => availableEquipment.find((e) => e.name === name)!);
    const [ultor, berserker] = ['Ultor ring', 'Berserker ring (i)'].map((name) => availableEquipment.find((e) => e.name === name)!);
    const setup = (id: string, name: string, weapon: typeof whip, ring: typeof whip) => {
      const player = generateEmptyPlayer(name);
      player.equipment.weapon = weapon;
      player.equipment.ring = ring;
      return { id, name, player };
    };
    const row = (setupId: string, dps: number) => ({
      setupId, monsterId: 'm', maxHit: 40, accuracy: 0.8, dps, ttk: 30, spec: null, issues: [],
    });
    mockRun.mockResolvedValue([{
      style: 'slash',
      setups: [setup('best-slash-0', 'Whip', whip, ultor), setup('best-slash-1', 'Whip', whip, berserker), setup('best-slash-2', 'Rapier', rapier, ultor)],
      rows: [row('best-slash-0', 7.5), row('best-slash-1', 7.4), row('best-slash-2', 7.0)],
      approximate: false,
      message: null,
      variants: {},
    }]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);

    // DPS and Max hit come first, right after the rank; no setup names, only the style
    expect([...container.querySelectorAll('thead th')].slice(0, 4).map((th) => th.textContent)).toEqual(['#', 'DPS', 'Max hit', 'Style']);
    const bodyRows = () => [...container.querySelectorAll('tbody tr')];
    expect(bodyRows()).toHaveLength(2);
    expect([...bodyRows()[0].children].slice(1, 3).map((td) => td.textContent)).toEqual(['7.500', '40']);
    // the best is marked with a trophy, still numbered for screen readers
    expect(bodyRows()[0].querySelector('[data-tooltip-content="Best"]')!.textContent).toBe('1');
    expect(bodyRows()[1].querySelector(`img[alt="${rapier.name}"]`)).not.toBeNull();
    expect(bodyRows()[1].firstElementChild!.textContent).toBe('2');

    const more = button(container, '1 more')!;
    expect(more.getAttribute('aria-expanded')).toBe('false');
    await act(async () => more.click());
    expect(bodyRows()).toHaveLength(3);
    // the alternative sits under its weapon's row, unranked, named by what it swaps in
    expect(bodyRows()[1].textContent).toContain(`With ${berserker.name}`);
    expect(bodyRows()[1].firstElementChild!.textContent).toBe('');
    expect(bodyRows()[2].firstElementChild!.textContent).toBe('2');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    // every row can be added to the bulk tool; an alternative is named by what sets it apart
    const adds = container.querySelectorAll<HTMLButtonElement>('button[aria-label="Add to bulk preset"]');
    expect(adds).toHaveLength(3);
    await act(async () => adds[1].click());
    await wait(10);
    const saved = mockData.get(STORAGE_KEY) as { presets: BulkPreset[]; activeId: string };
    expect(saved.presets.find((p) => p.id === saved.activeId)!.setups.map((x) => x.name)).toContain(`Whip with ${berserker.name}`);
    await unmount();
  });

  test('several styles get a summary of each style\'s best, the strongest marked', async () => {
    const magic = { ...outcome('Shadow'), style: 'magic' as const };
    magic.rows = [{ ...magic.rows[0], setupId: 'best-magic-0', dps: 9 }];
    magic.setups = [{ ...magic.setups[0], id: 'best-magic-0' }];
    mockRun.mockResolvedValue([outcome('Whip'), magic]);
    const { container, unmount } = await mount();
    await act(async () => find(container).click());
    await wait(10);
    const cards = [...container.querySelector('nav[aria-label="Best per style"]')!.querySelectorAll('a')];
    expect(cards.map((a) => a.getAttribute('href'))).toEqual(['#best-slash', '#best-magic']);
    expect(cards[0].textContent).toContain('7.500');
    expect(cards[0].textContent).not.toContain('Best');
    expect(cards[1].textContent).toContain('9.000');
    expect(cards[1].textContent).toContain('Best');
    expect(container.querySelector('#best-magic')).not.toBeNull();
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
