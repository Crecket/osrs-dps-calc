import { describe, expect, test } from '@jest/globals';
import {
  defaultSort, firstClickDir, runKey, selectRows, SortState,
} from '@/bulk/lib/table';
import { BulkPreset, BulkRow } from '@/bulk/types';
import { generateEmptyPlayer } from '@/state';
import { monsterFromSearch } from '@/bulk/lib/presetIO';
import { getMonsters } from '@/lib/Monsters';
import { Prayer } from '@/enums/Prayer';

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
  maxHit: 50, accuracy: 0.5, expected, dps: 1, regenDps: 0.1, partial: false,
});
const ids = (rows: BulkRow[]) => rows.map((r) => `${r.setupId}${r.monsterId}`);
const opts = (sort: SortState, mode: 'normal' | 'spec' = 'normal') => ({ mode, sort });

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

describe('runKey', () => {
  const preset = (setupIds: string[], monsterId: string | null): BulkPreset => ({
    id: 'p',
    name: 'P',
    createdAt: 0,
    updatedAt: 0,
    serializationVersion: 1,
    setups: setupIds.map((id) => ({ id, name: id, player: generateEmptyPlayer(id) })),
    monster: monsterId ? { id: monsterId, monster: { id: 1 } as never } : null,
  });

  test('null when the preset cannot run', () => {
    expect(runKey(null)).toBeNull();
    expect(runKey(preset(['a'], null))).toBeNull();
    expect(runKey(preset([], 'm'))).toBeNull();
  });

  test('changes with the setups and the target, not with names', () => {
    const base = runKey(preset(['a', 'b'], 'm'));
    expect(runKey(preset(['a'], 'm'))).not.toBe(base);
    expect(runKey(preset(['a', 'b'], 'n'))).not.toBe(base);

    const renamed = preset(['a', 'b'], 'm');
    renamed.setups[0].name = 'Renamed';
    expect(runKey(renamed)).toBe(base);
  });

  test('changes when a setup or the target is edited in place', () => {
    const real = (): BulkPreset => {
      const p = preset([], null);
      p.setups = [{ id: 'a', name: 'A', player: generateEmptyPlayer('A') }];
      p.monster = { ...monsterFromSearch(getMonsters().find((m) => m.name === 'Vasa Nistirio')!), id: 'm' };
      return p;
    };
    const base = runKey(real());

    const prayed = real();
    prayed.setups[0].player.prayers = [Prayer.PIETY];
    expect(runKey(prayed)).not.toBe(base);

    const scaled = real();
    scaled.monster!.monster.inputs.partySize = 3;
    expect(runKey(scaled)).not.toBe(base);
  });
});
