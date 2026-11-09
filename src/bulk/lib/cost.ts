import { Player } from '@/types/Player';
import { itemPrice, Prices } from '@/raid/lib/prices';
import { GEAR_SLOT_ORDER } from '@/bulk/types';

export interface SetupCost {
  total: number;
  // worn items the total counts as nothing: untradeable, and not made from anything tradeable
  unpriced: string[];
}

const NOT_OWNED = new Set<number>();

/**
 * What a setup's gear costs to buy, with the raid planner's prices: an untradeable item made from tradeable parts costs
 * what its parts do. Null without prices, as that isn't the same as everything being free.
 */
export const setupCost = (player: Player, prices: Prices | null): SetupCost | null => {
  if (!prices || prices.byId.size === 0) return null;
  const cost: SetupCost = { total: 0, unpriced: [] };
  for (const slot of GEAR_SLOT_ORDER) {
    const item = player.equipment[slot];
    if (item) {
      const price = itemPrice(item.id, prices, NOT_OWNED);
      cost.total += price;
      if (price === 0) cost.unpriced.push(item.name);
    }
  }
  return cost;
};
