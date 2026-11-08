/** Setups as a worker message needs them: most of a setup's 4.5 KB is its items, which the worker has too. */
import { findEquipment } from '@/lib/Equipment';
import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { BulkSetup } from '@/bulk/types';

type SlimPiece = Pick<EquipmentPiece, 'id' | 'itemVars'>;

const mapEquipment = (setup: BulkSetup, f: (piece: EquipmentPiece) => unknown): BulkSetup => ({
  ...setup,
  player: {
    ...setup.player,
    equipment: Object.fromEntries(Object.entries(setup.player.equipment)
      .map(([slot, piece]) => [slot, piece && f(piece)])) as unknown as PlayerEquipment,
  },
});

/** Each item as its id and item vars; an item the data doesn't have (a custom one) stays whole */
export const slimSetup = (setup: BulkSetup): BulkSetup => mapEquipment(setup, (piece): SlimPiece | EquipmentPiece => (
  findEquipment(piece.id) ? { id: piece.id, itemVars: piece.itemVars } : piece
));

/** slimSetup undone */
export const fullSetup = (setup: BulkSetup): BulkSetup => mapEquipment(setup, (whole) => {
  const piece: SlimPiece | EquipmentPiece = whole;
  if ('slot' in piece) return piece;
  const item = findEquipment(piece.id)!;
  return piece.itemVars ? { ...item, itemVars: piece.itemVars } : item;
});
