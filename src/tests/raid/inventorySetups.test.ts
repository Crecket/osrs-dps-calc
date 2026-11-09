import { describe, expect, test } from '@jest/globals';
import { exportInventorySetup, parseInventorySetup } from '@/raid/lib/inventorySetups';
import type { Layout } from '@/raid/lib/layout';
import tfa from '@/tests/raid/fixtures/tfaSetup.json';

describe('parseInventorySetup', () => {
  test('parses the TFA setup', () => {
    const ids = parseInventorySetup(JSON.stringify(tfa));
    [26235, 28922, 34715, 21003, 27610, 21944].forEach((id) => expect(ids).toContain(id));
    expect(new Set(ids).size).toBe(ids.length);
  });

  test('accepts the inner setup object', () => {
    expect(parseInventorySetup(JSON.stringify(tfa.setup))).toContain(34715);
  });

  test('rejects other JSON', () => {
    expect(() => parseInventorySetup('{"foo":1}')).toThrow('Not an Inventory Setups export');
    expect(() => parseInventorySetup('not json')).toThrow('Not an Inventory Setups export');
  });
});

describe('exportInventorySetup', () => {
  const layout: Layout = {
    worn: {
      head: 27235, weapon: 20997, ammo: 11212, ring: 28310, quiverAmmo: 21944,
    },
    inventory: [{ kind: 'item', itemId: 4151 }, { kind: 'supply', label: 'Brew' }, { kind: 'supply', label: 'Reserved' }, null],
    overflow: 0,
  };

  test('reads back through the import, with every item and the supplies but not the reserved cells', () => {
    expect(parseInventorySetup(exportInventorySetup(layout, 'x')).sort((a, b) => a - b))
      .toEqual([27235, 20997, 11212, 28310, 21944, 4151, 6685].sort((a, b) => a - b));
  });

  test('puts worn items at the game\'s slot numbers', () => {
    const { setup } = JSON.parse(exportInventorySetup(layout, 'Raid loadout'));
    expect(setup.name).toBe('Raid loadout');
    expect(setup.eq).toHaveLength(14);
    expect(setup.eq[0].id).toBe(27235);
    expect(setup.eq[3].id).toBe(20997);
    expect(setup.eq[12].id).toBe(28310);
    expect(setup.eq[13].id).toBe(11212);
    expect(setup.inv).toHaveLength(4);
    expect(setup.inv[2]).toBeNull();
    expect(setup.qv[0].id).toBe(21944);
  });
});
