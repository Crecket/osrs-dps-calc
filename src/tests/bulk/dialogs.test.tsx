import {
  afterEach, beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';

jest.mock('localforage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async (_: string, value: unknown) => value },
}));
const mockToast = { success: jest.fn(), info: jest.fn(), error: jest.fn() };
jest.mock('react-toastify', () => ({ toast: mockToast, ToastContainer: () => null }));
jest.mock('next/navigation', () => ({ usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const { BulkStore, BulkStoreContext } = require('@/bulk/state/BulkStore') as typeof import('@/bulk/state/BulkStore');
const PresetBar = require('@/bulk/components/PresetBar').default as React.FC;
const SetupList = require('@/bulk/components/SetupList').default as React.FC;
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('bulk dialogs', () => {
  let container: HTMLDivElement;
  let root: Root;
  let bulk: InstanceType<typeof BulkStore>;

  const render = (node: React.ReactNode) => act(() => {
    root.render(<BulkStoreContext.Provider value={bulk}>{node}</BulkStoreContext.Provider>);
  });
  const dialog = () => container.querySelector('[role="dialog"]') as HTMLFormElement | null;
  const input = () => dialog()!.querySelector('input') as HTMLInputElement;
  const submit = () => dialog()!.querySelector('button[type="submit"]') as HTMLButtonElement;
  const button = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) as HTMLButtonElement;
  const press = (key: string, opts: KeyboardEventInit = {}) => act(() => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true, ...opts,
    }));
  });
  const type = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
  // what Enter does in a form: browsers submit it through its submit button, which jsdom doesn't do from a key press
  const enter = () => act(() => {
    dialog()!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    bulk = new BulkStore({ getItem: async () => null, setItem: async (_: string, value: never) => value });
    await bulk.load();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('is a modal dialog with its input focused and selected, and never calls the browser\'s prompts', () => {
    const prompt = jest.spyOn(window, 'prompt');
    render(<PresetBar />);
    act(() => button('New').click());

    expect(dialog()!.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(dialog()!.getAttribute('aria-labelledby')!);
    expect(title?.textContent).toBe('New preset');
    expect(document.activeElement).toBe(input());
    expect(input().selectionEnd).toBe('New preset'.length);
    expect(prompt).not.toHaveBeenCalled();
    prompt.mockRestore();
  });

  test('new preset: Enter creates it with the trimmed name, and the focus goes back', () => {
    render(<PresetBar />);
    const opener = button('New');
    opener.focus();
    act(() => opener.click());
    type('  Raids  ');
    enter();

    expect(bulk.active!.name).toBe('Raids');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  test('a blank name can\'t be submitted', () => {
    render(<PresetBar />);
    const before = bulk.presets.length;
    act(() => button('New').click());
    type('   ');

    expect(submit().disabled).toBe(true);
    enter();
    expect(bulk.presets).toHaveLength(before);
    expect(dialog()).not.toBeNull();
  });

  test('Escape, Cancel and a click outside change nothing', () => {
    render(<PresetBar />);
    const before = bulk.presets.length;
    const opener = button('New');
    opener.focus();

    act(() => opener.click());
    press('Escape');
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(opener);

    act(() => opener.click());
    act(() => button('Cancel').click());
    expect(dialog()).toBeNull();

    act(() => opener.click());
    act(() => {
      dialog()!.parentElement!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(dialog()).toBeNull();

    expect(bulk.presets).toHaveLength(before);
  });

  test('a click inside doesn\'t close it', () => {
    render(<PresetBar />);
    act(() => button('New').click());
    act(() => {
      dialog()!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });
    expect(dialog()).not.toBeNull();
  });

  test('Tab stays inside the dialog', () => {
    render(<PresetBar />);
    act(() => button('New').click());

    submit().focus();
    press('Tab');
    expect(document.activeElement).toBe(input());
    press('Tab', { shiftKey: true });
    expect(document.activeElement).toBe(submit());
  });

  test('rename starts from the current name', () => {
    render(<PresetBar />);
    const { id, name } = bulk.active!;
    act(() => button('Rename').click());
    expect(input().value).toBe(name);
    type('Renamed');
    enter();
    expect(bulk.presets.find((p) => p.id === id)!.name).toBe('Renamed');
  });

  test('deleting a preset asks first, focused on the confirm button', () => {
    render(<PresetBar />);
    const { id, name } = bulk.active!;
    act(() => button('Delete').click());
    expect(dialog()!.textContent).toContain(name);
    expect(document.activeElement).toBe(submit());
    expect(bulk.presets.some((p) => p.id === id)).toBe(true);

    enter();
    expect(bulk.presets.some((p) => p.id === id)).toBe(false);
  });

  test('deleting all setups asks first, and the note undoes it', () => {
    render(<SetupList />);
    const names = bulk.active!.setups.map((s) => s.name);

    act(() => button('Clear').click());
    expect(dialog()!.textContent).toContain(`Delete all ${names.length} setups`);
    press('Escape');
    expect(bulk.active!.setups).toHaveLength(names.length);
    expect(mockToast.info).not.toHaveBeenCalled();

    act(() => button('Clear').click());
    enter();
    expect(bulk.active!.setups).toHaveLength(0);
    expect(dialog()).toBeNull();

    const [content, options] = mockToast.info.mock.calls[0] as [(p: { closeToast: () => void }) => React.ReactElement, { autoClose: number }];
    expect(options.autoClose).toBeGreaterThan(0);
    const closeToast = jest.fn();
    const noteContainer = document.createElement('div');
    document.body.appendChild(noteContainer);
    const noteRoot = createRoot(noteContainer);
    act(() => noteRoot.render(content({ closeToast })));
    expect(noteContainer.textContent).toContain(`Deleted ${names.length} setups`);
    const undo = noteContainer.querySelector('button')!;
    expect(document.activeElement).toBe(undo);

    act(() => undo.click());
    expect(bulk.active!.setups.map((s) => s.name)).toEqual(names);
    expect(closeToast).toHaveBeenCalled();
    act(() => noteRoot.unmount());
    noteContainer.remove();
  });
});
