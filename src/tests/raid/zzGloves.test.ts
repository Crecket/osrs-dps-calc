import { test } from '@jest/globals';
import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import { bestPool } from '@/best/lib/candidates';

test('dropped', () => {
  const pool = new Set(bestPool().map((e) => e.id));
  const ids = new Set(availableEquipment.map((e) => e.id));
  // items that pass the other filters (bestPool on each item alone) but not the whole pool
  availableEquipment.filter((e) => getCanonicalItemId(e.id) === e.id && bestPool([e]).length === 1 && !pool.has(e.id))
    .forEach((e) => console.log('DROP', e.id, e.name, e.version, ids.size));
});
