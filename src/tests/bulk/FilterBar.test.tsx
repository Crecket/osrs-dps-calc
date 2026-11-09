import {
  afterEach, beforeEach, describe, expect, jest, test,
} from '@jest/globals';
import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { applyOverrides, overrideDuplicates, toggleLeftOut } from '@/bulk/lib/filters';
import { defaultSetups } from '@/bulk/lib/defaultSetups';

jest.mock('localforage', () => ({
  __esModule: true,
  default: { getItem: async () => null, setItem: async (_: string, value: unknown) => value },
}));

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const { BulkStore, BulkStoreContext } = require('@/bulk/state/BulkStore') as typeof import('@/bulk/state/BulkStore');
const FilterBar = require('@/bulk/components/FilterBar').default as typeof import('@/bulk/components/FilterBar').default;
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('toggleLeftOut', () => {
  test('leaves a slot out, puts it back, and replaces an item override', () => {
    const ring = toggleLeftOut({}, 'ring');
    expect(ring).toEqual({ ring: null });
    expect(toggleLeftOut(ring, 'ring')).toEqual({});
    expect(toggleLeftOut(ring, 'feet')).toEqual({ ring: null, feet: null });
    expect(toggleLeftOut({ ring: 28307 }, 'ring')).toEqual({ ring: null });
  });

  test('setups are compared without the slot, and those that then match are duplicates', () => {
    const { setups } = defaultSetups();
    const ultor = setups.find((s) => s.player.equipment.ring?.name.startsWith('Ultor'))!;
    const other = {
      ...ultor,
      id: 'other',
      name: 'Other ring',
      player: { ...ultor.player, equipment: { ...ultor.player.equipment, ring: null } },
    };
    const overrides = toggleLeftOut({}, 'ring');

    expect(applyOverrides(ultor, overrides).player.equipment.ring).toBeNull();
    expect([...overrideDuplicates([ultor, other], overrides)]).toEqual([['other', ultor.name]]);
  });
});

describe('FilterBar leave out slots', () => {
  let container: HTMLDivElement;
  let root: Root;
  let bulk: InstanceType<typeof BulkStore>;

  const buttonNamed = (text: string) => [...container.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;
  const slot = (name: string) => container.querySelector(`button[aria-label="${name} slot"]`) as HTMLButtonElement;

  beforeEach(async () => {
    bulk = new BulkStore({ getItem: async () => null, setItem: async (_: string, value: never) => value });
    await bulk.load();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root.render(<BulkStoreContext.Provider value={bulk}><FilterBar filteredCount={0} /></BulkStoreContext.Provider>);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  test('picks several slots, staying open, and picking one again puts it back', () => {
    act(() => buttonNamed('Leave out slots').click());
    expect(slot('weapon').disabled).toBe(true);

    act(() => slot('ring').click());
    act(() => slot('cape').click());
    expect(bulk.filters.overrides).toEqual({ ring: null, cape: null });
    expect(slot('ring').getAttribute('aria-pressed')).toBe('true');
    expect(container.textContent).toContain('No ring');

    act(() => slot('ring').click());
    expect(bulk.filters.overrides).toEqual({ cape: null });
    expect(slot('ring').getAttribute('aria-pressed')).toBe('false');
  });

  test('the button closes what it opened', () => {
    const button = buttonNamed('Leave out slots');
    act(() => button.click());
    expect(slot('ring')).not.toBeNull();
    act(() => {
      button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      button.click();
    });
    expect(slot('ring')).toBeNull();
  });
});
