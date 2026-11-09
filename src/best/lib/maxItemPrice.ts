import { BestInputs } from '@/best/types';
import { bestPool } from '@/best/lib/candidates';
import { itemPrice, Prices } from '@/raid/lib/prices';

/**
 * The inputs with items dearer than `maxItemPrice` excluded, as the search takes them. Without a limit or prices they
 * stay as they are: with no prices there is nothing to go by, which the field says.
 */
// eslint-disable-next-line import/prefer-default-export
export const withMaxItemPrice = (inputs: BestInputs, prices: Prices | null): BestInputs => {
  const cap = inputs.maxItemPrice;
  if (typeof cap !== 'number' || !prices) return inputs;
  const above = bestPool().filter((e) => itemPrice(e.id, prices, new Set()) > cap).map((e) => e.id);
  return { ...inputs, excludedItemIds: [...new Set([...(inputs.excludedItemIds ?? []), ...above])] };
};
