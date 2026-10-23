import { describe, expect, test } from '@jest/globals';
import {
  applyOverrides, DEFAULT_FILTERS, filterReason, overriddenSlots, overrideDuplicates, readFilters, styleGroup,
} from '@/bulk/lib/filters';
import { defaultSetups } from '@/bulk/lib/defaultSetups';
import { computeRow } from '@/bulk/lib/compute';
import { monsterFromSearch } from '@/bulk/lib/presetIO';
import { getMonsters } from '@/lib/Monsters';
import { BulkFilters, BulkRow } from '@/bulk/types';

const LIGHTBEARER = 25975;
const ELIDINIS_WARD = 27251;
const setup = (name: string) => defaultSetups().setups.find((s) => s.name === name)!;
const row = (setupId: string, dps: number, spec: number | null = null): BulkRow => ({
  setupId,
  monsterId: 'm',
  maxHit: 1,
  accuracy: 1,
  dps,
  ttk: 1,
  spec: spec === null ? null : {
    maxHit: 1, accuracy: 1, expected: 1, dps: spec, regenDps: 1, partial: false,
  },
  issues: [],
});
const filters = (f: Partial<BulkFilters>): BulkFilters => ({ ...DEFAULT_FILTERS, ...f });

describe('applyOverrides', () => {
  test('swaps the slot in a copy and leaves the setup alone', () => {
    const scythe = setup('Max scythe');
    const result = applyOverrides(scythe, { ring: LIGHTBEARER });

    expect(result.player.equipment.ring?.name).toBe('Lightbearer');
    expect(result.player.equipment.weapon?.id).toBe(scythe.player.equipment.weapon?.id);
    expect(scythe.player.equipment.ring?.name).toBe('Ultor ring');
    expect(result.id).toBe(scythe.id);
  });

  test('the override is what gets calculated', () => {
    const scythe = setup('Max scythe');
    const abyssal = monsterFromSearch(getMonsters().find((m) => m.id === 415)!);
    const vorkath = monsterFromSearch(getMonsters().find((m) => m.name === 'Vorkath')!);
    const salve = { neck: 12018 };

    // salve does nothing against a demon, so losing the rancour costs damage; against undead it's better
    expect(computeRow(applyOverrides(scythe, salve), abyssal).dps).toBeLessThan(computeRow(scythe, abyssal).dps);
    expect(computeRow(applyOverrides(scythe, salve), vorkath).dps).toBeGreaterThan(computeRow(scythe, vorkath).dps);
  });

  test('null empties the slot', () => {
    expect(applyOverrides(setup('Max scythe'), { ring: null }).player.equipment.ring).toBeNull();
  });

  test('no overrides returns the same setup', () => {
    const scythe = setup('Max scythe');
    expect(applyOverrides(scythe, {})).toBe(scythe);
  });

  test('never touches the weapon, or the shield of a two-handed weapon, or unknown items', () => {
    const scythe = setup('Max scythe');
    const result = applyOverrides(scythe, { weapon: LIGHTBEARER, shield: ELIDINIS_WARD, ring: -12345 });

    expect(result.player.equipment.weapon?.id).toBe(scythe.player.equipment.weapon?.id);
    expect(result.player.equipment.shield).toBeNull();
    expect(result.player.equipment.ring?.name).toBe('Ultor ring');
    expect(overriddenSlots(scythe.player, { weapon: LIGHTBEARER, shield: ELIDINIS_WARD, ring: -12345 })).toEqual([]);
    expect(overriddenSlots(setup('Max fang').player, { shield: ELIDINIS_WARD, ring: LIGHTBEARER })).toEqual(['shield', 'ring']);
  });
});

describe('filterReason', () => {
  test('style groups', () => {
    expect(styleGroup(setup('Max scythe').player)).toBe('melee');
    expect(styleGroup(setup('Max range').player)).toBe('ranged');
    expect(styleGroup(setup('Max ayak').player)).toBe('magic');
    expect(styleGroup(setup('Max harm fire surge').player)).toBe('magic');
  });

  test('hidden styles and minimum DPS', () => {
    const range = setup('Max range');
    expect(filterReason(row(range.id, 10), range, DEFAULT_FILTERS, 'normal')).toBeNull();
    expect(filterReason(row(range.id, 10), range, filters({ hiddenStyles: ['ranged'] }), 'normal')).toBe('Ranged hidden');
    expect(filterReason(row(range.id, 10), range, filters({ hiddenStyles: ['melee'] }), 'normal')).toBeNull();
    expect(filterReason(row(range.id, 7.5), range, filters({ minDps: 8 }), 'normal')).toBe('Below 8 DPS');
    expect(filterReason(row(range.id, 8), range, filters({ minDps: 8 }), 'normal')).toBeNull();
  });

  test('spec mode compares the spec DPS', () => {
    const range = setup('Max range');
    expect(filterReason(row(range.id, 10, 5), range, filters({ minDps: 8 }), 'spec')).toBe('Below 8 DPS');
    expect(filterReason(row(range.id, 1, 9), range, filters({ minDps: 8 }), 'spec')).toBeNull();
  });

  test('rows with errors are never filtered by DPS', () => {
    const range = setup('Max range');
    expect(filterReason({ ...row(range.id, 0), error: 'boom' }, range, filters({ minDps: 8 }), 'normal')).toBeNull();
  });
});

describe('readFilters', () => {
  test('fills in defaults and drops bad values', () => {
    expect(readFilters(undefined)).toEqual(DEFAULT_FILTERS);
    expect(readFilters({
      overrides: { ring: LIGHTBEARER, neck: 'x', bogus: 1 }, hiddenStyles: ['magic', 'nope'], minDps: 'a', showFiltered: true,
    })).toEqual({
      overrides: { ring: LIGHTBEARER }, hiddenStyles: ['magic'], minDps: null, showFiltered: true,
    });
  });
});

describe('overrideDuplicates', () => {
  test('setups the overrides make identical are duplicates of the first one', () => {
    const ultor = setup('Max scythe');
    const bellator = setup('Max scythe bellator');
    const fang = setup('Max fang');

    expect(overrideDuplicates([ultor, bellator, fang], {}).size).toBe(0);
    expect(overrideDuplicates([ultor, bellator, fang], { ring: 28307 }).size).toBe(1);
    expect(overrideDuplicates([ultor, bellator, fang], { neck: 19553 }).size).toBe(0);
    expect([...overrideDuplicates([ultor, bellator, fang], { ring: LIGHTBEARER })]).toEqual([[bellator.id, 'Max scythe']]);
  });

  test('setups that were already the same count too', () => {
    const scythe = setup('Max scythe');
    const copy = { ...scythe, id: 'copy', name: 'Copy' };
    expect([...overrideDuplicates([scythe, copy], {})]).toEqual([['copy', 'Max scythe']]);
  });
});
