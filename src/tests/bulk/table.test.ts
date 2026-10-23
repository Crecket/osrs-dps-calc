import { describe, expect, test } from '@jest/globals';
import {
  defaultSort, firstClickDir, selectRows, SortState,
} from '@/bulk/lib/table';
import { BulkRow } from '@/bulk/types';

const row = (setupId: string, monsterId: string, over: Partial<BulkRow> = {}): BulkRow => ({
  setupId,
  monsterId,
  maxHit: 10,
  accuracy: 0.5,
  dps: 1,
  ttk: 60,
  spec: null,
  issues: [],
  ...over,
});
const spec = (expected: number) => ({
  maxHit: 50, accuracy: 0.5, expected, dps: 1, partial: false,
});
const ids = (rows: BulkRow[]) => rows.map((r) => `${r.setupId}${r.monsterId}`);
const opts = (sort: SortState, mode: 'normal' | 'spec' = 'normal', monsterId: string | null = null) => ({ mode, sort, monsterId });

describe('table', () => {
  test('default sort is dps desc', () => {
    const rows = [row('a', '1', { dps: 2 }), row('b', '1', { dps: 5 }), row('c', '1', { dps: 3 })];

    expect(defaultSort('normal')).toEqual({ key: 'dps', dir: 'desc' });
    expect(ids(selectRows(rows, opts(defaultSort('normal'))))).toEqual(['b1', 'c1', 'a1']);
  });

  test('spec mode hides rows with no spec', () => {
    const rows = [row('a', '1'), row('b', '1', { spec: spec(20) })];

    expect(ids(selectRows(rows, opts(defaultSort('spec'), 'spec')))).toEqual(['b1']);
    expect(selectRows([row('a', '1')], opts(defaultSort('spec'), 'spec'))).toEqual([]);
  });

  test('spec mode keeps error rows so failures stay visible', () => {
    const rows = [row('a', '1', { error: 'boom', dps: 0 }), row('b', '1', { spec: spec(20) })];

    expect(ids(selectRows(rows, opts(defaultSort('spec'), 'spec')))).toEqual(['b1', 'a1']);
  });

  test('spec mode default sort is specExpected desc', () => {
    const rows = [row('a', '1', { spec: spec(20), dps: 9 }), row('b', '1', { spec: spec(40), dps: 1 })];

    expect(defaultSort('spec')).toEqual({ key: 'specExpected', dir: 'desc' });
    expect(ids(selectRows(rows, opts(defaultSort('spec'), 'spec')))).toEqual(['b1', 'a1']);
  });

  test('monster filter', () => {
    const rows = [row('a', '1'), row('a', '2'), row('b', '2')];

    expect(ids(selectRows(rows, opts(defaultSort('normal'), 'normal', '2')))).toEqual(['a2', 'b2']);
  });

  test('error rows sort last in both directions', () => {
    const rows = [row('e', '1', { dps: 0, error: 'boom' }), row('a', '1', { dps: 0.5 }), row('b', '1', { dps: 3 })];

    expect(ids(selectRows(rows, opts({ key: 'dps', dir: 'desc' })))).toEqual(['b1', 'a1', 'e1']);
    expect(ids(selectRows(rows, opts({ key: 'dps', dir: 'asc' })))).toEqual(['a1', 'b1', 'e1']);
  });

  test('ttk first click is ascending and null ttk sorts last', () => {
    const rows = [row('a', '1', { ttk: null }), row('b', '1', { ttk: 90 }), row('c', '1', { ttk: 30 })];

    expect(firstClickDir('ttk')).toBe('asc');
    expect(firstClickDir('dps')).toBe('desc');
    expect(ids(selectRows(rows, opts({ key: 'ttk', dir: 'asc' })))).toEqual(['c1', 'b1', 'a1']);
    expect(ids(selectRows(rows, opts({ key: 'ttk', dir: 'desc' })))).toEqual(['b1', 'c1', 'a1']);
  });

  test('ties keep input order', () => {
    const rows = [row('a', '1'), row('b', '1'), row('c', '1')];

    expect(ids(selectRows(rows, opts({ key: 'dps', dir: 'desc' })))).toEqual(['a1', 'b1', 'c1']);
  });
});
