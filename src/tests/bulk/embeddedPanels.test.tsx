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
jest.mock('react-toastify', () => ({ toast: { success: jest.fn(), error: jest.fn() }, ToastContainer: () => null }));
jest.mock('next/navigation', () => ({ usePathname: () => '/', useSearchParams: () => new URLSearchParams() }));

/* eslint-disable @typescript-eslint/no-var-requires, global-require */
const { BulkStore, BulkStoreContext } = require('@/bulk/state/BulkStore') as typeof import('@/bulk/state/BulkStore');
const SetupEditor = require('@/bulk/components/SetupEditor').default as React.FC<{ setupId: string }>;
const TargetMonster = require('@/bulk/components/TargetMonster').default as React.FC;
const SetupQuickEdit = require('@/bulk/components/SetupQuickEdit').default as typeof import('@/bulk/components/SetupQuickEdit').default;
const EquipmentSearch = require('@/bulk/components/EquipmentSearch').default as typeof import('@/bulk/components/EquipmentSearch').default;
/* eslint-enable @typescript-eslint/no-var-requires, global-require */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('upstream panels embedded in the bulk tool', () => {
  let container: HTMLDivElement;
  let root: Root;
  let bulk: InstanceType<typeof BulkStore>;

  const render = (node: React.ReactNode) => act(() => {
    root.render(<BulkStoreContext.Provider value={bulk}>{node}</BulkStoreContext.Provider>);
  });
  const scythe = () => bulk.active!.setups.find((s) => s.name === 'Max scythe')!;

  beforeEach(async () => {
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

  test('the setup editor shows the setup and leaves it untouched', () => {
    const before = bulk.active!.updatedAt;
    render(<SetupEditor setupId={scythe().id} />);

    expect(container.querySelector('input[placeholder="Search for equipment..."]')).not.toBeNull();
    expect(bulk.active!.updatedAt).toBe(before);
  });

  test('the target monster panel adopts its monster as the target', () => {
    render(<TargetMonster />);

    expect(container.querySelector('input[placeholder="Search for monster..."]')).not.toBeNull();
    expect(bulk.active!.monster).not.toBeNull();
  });

  test.each(['prayers', 'potions', 'levels'] as const)('the %s quick edit opens', (kind) => {
    render(<SetupQuickEdit setup={scythe()} open={kind} onOpen={() => {}} />);

    expect(container.querySelector('.absolute')?.childElementCount).toBeGreaterThan(0);
  });

  test('the item search offers only what its filter allows', () => {
    render(<EquipmentSearch filter={(item) => item.id === 4151} onPick={() => {}} />);
    const input = container.querySelector('input')!;

    act(() => { input.focus(); input.click(); });

    expect(input.placeholder).toBe('Search for equipment...');
    expect(container.textContent).not.toContain('Dragon scimitar');
  });
});
