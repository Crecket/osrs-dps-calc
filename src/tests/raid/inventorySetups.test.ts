import { describe, expect, test } from '@jest/globals';
import { parseInventorySetup } from '@/raid/lib/inventorySetups';
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
