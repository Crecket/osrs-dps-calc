import { describe, expect, test } from '@jest/globals';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { observable } from 'mobx';
import BulkTable from '@/bulk/components/BulkTable';
import { defaultSort } from '@/bulk/lib/table';
import { BulkRow, BulkSetup } from '@/bulk/types';
import { generateEmptyPlayer } from '@/state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe('BulkTable', () => {
  test('shows rows for setups added to the same observable arrays after first render', () => {
    // the preset's arrays are mutated in place, so their identity never changes
    const setups = observable<BulkSetup>([]);
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (rows: BulkRow[]) => act(() => {
      root.render(
        <BulkTable rows={rows} setups={setups} mode="normal" sort={defaultSort('normal')} onSort={() => {}} hasRun />,
      );
    });

    render([]);
    setups.push({ id: 's1', name: 'Whip', player: generateEmptyPlayer('Whip') });
    render([{
      setupId: 's1', monsterId: 'm1', maxHit: 10, accuracy: 0.5, dps: 1.234, ttk: 30, spec: null, issues: [],
    }]);

    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('1.234');

    // renaming a setup updates the table without the parent re-rendering
    act(() => { setups[0].name = 'Renamed whip'; });
    expect(container.textContent).toContain('Renamed whip');
    act(() => root.unmount());
  });

  test('spec mode only claims there are no specs after a run', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    const render = (hasRun: boolean) => act(() => {
      root.render(
        <BulkTable rows={[]} setups={[]} mode="spec" sort={defaultSort('spec')} onSort={() => {}} hasRun={hasRun} />,
      );
    });

    render(false);
    expect(container.textContent).toContain('No results yet');
    expect(container.textContent).not.toContain('press Run');
    expect(container.textContent).not.toContain('supported special attack');

    render(true);
    expect(container.textContent).toContain('No setups in this preset have a supported special attack');
    act(() => root.unmount());
  });
});
