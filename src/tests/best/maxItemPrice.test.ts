import { describe, expect, test } from '@jest/globals';
import { withMaxItemPrice } from '@/best/lib/maxItemPrice';
import { BestInputs } from '@/best/types';
import type { Prices } from '@/raid/lib/prices';

const SCYTHE = 22325;
const WHIP = 4151;
const prices: Prices = { byId: new Map([[SCYTHE, 1e9], [WHIP, 2e6]]), byName: new Map() };
const inputs = (over: Partial<BestInputs>) => ({ excludedItemIds: [1], ...over }) as BestInputs;

describe('withMaxItemPrice', () => {
  test('excludes what costs more, next to what was excluded already', () => {
    const ids = withMaxItemPrice(inputs({ maxItemPrice: 50e6 }), prices).excludedItemIds!;
    expect(ids).toContain(SCYTHE);
    expect(ids).toContain(1);
    expect(ids).not.toContain(WHIP);
  });

  test('changes nothing without a limit or prices', () => {
    expect(withMaxItemPrice(inputs({ maxItemPrice: null }), prices).excludedItemIds).toEqual([1]);
    expect(withMaxItemPrice(inputs({ maxItemPrice: 50e6 }), null).excludedItemIds).toEqual([1]);
  });
});
