import { availableEquipment, getCanonicalItemId } from '@/lib/Equipment';
import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { BulkSetup, GEAR_SLOT_ORDER } from '@/bulk/types';
import { MagicOption } from '@/raid/types';

export const INVENTORY_SIZE = 28;

export type SupplyLabel = 'Brew' | 'Restore' | 'Rune pouch' | 'Reserved';
export type InvCell = { kind: 'item'; itemId: number } | { kind: 'supply'; label: SupplyLabel } | null;

export interface Supplies {
  brews: number;
  restores: number;
  /** Other slots kept free, e.g. boost potions */
  reserved: number;
}

export type WornSlot = keyof PlayerEquipment | 'quiverAmmo';

export interface Layout {
  worn: Partial<Record<WornSlot, number>>;
  inventory: InvCell[];
  /** Switches that didn't fit in the inventory */
  overflow: number;
}

export const runePouchSlots = (magic: MagicOption): number => (magic === 'none' ? 0 : 1);

const supplySlots = (s: Supplies, magic: MagicOption) => s.brews + s.restores + s.reserved + runePouchSlots(magic);

/** Inventory slots left for switches after supplies and the rune pouch */
export const freeSwitchSlots = (s: Supplies, magic: MagicOption): number => Math.max(0, INVENTORY_SIZE - supplySlots(s, magic));

let itemsById: Map<number, EquipmentPiece> | null = null;
const itemById = (id: number) => {
  if (!itemsById) itemsById = new Map(availableEquipment.map((e) => [e.id, e]));
  return itemsById.get(id);
};

/**
 * The loadout as worn gear and a 28-slot inventory: `main`'s gear is worn, with a second ammo in the quiver slot when
 * a Dizana's quiver (or its max cape) is worn; every other item is an inventory switch, in `itemIds` order, followed by
 * the rune pouch, reserved slots, restores and brews. Switches that don't fit are counted in `overflow`, supplies never.
 */
export const layoutLoadout = (itemIds: number[], main: BulkSetup | null, supplies: Supplies, magic: MagicOption): Layout => {
  const worn: Layout['worn'] = {};
  GEAR_SLOT_ORDER.forEach((slot) => {
    const item = main?.player.equipment[slot];
    if (item) worn[slot] = item.id;
  });
  const wornIds = new Set(Object.values(worn).map(getCanonicalItemId));
  let switches = itemIds.filter((id) => !wornIds.has(getCanonicalItemId(id)));

  if (main?.player.equipment.cape?.name.includes('Dizana\'s')) {
    const second = switches.find((id) => itemById(id)?.slot === 'ammo');
    if (second !== undefined) {
      worn.quiverAmmo = second;
      switches = switches.filter((id) => id !== second);
    }
  }

  const supplyCells: InvCell[] = [
    ...Array<SupplyLabel>(runePouchSlots(magic)).fill('Rune pouch'),
    ...Array<SupplyLabel>(supplies.reserved).fill('Reserved'),
    ...Array<SupplyLabel>(supplies.restores).fill('Restore'),
    ...Array<SupplyLabel>(supplies.brews).fill('Brew'),
  ].map((label) => ({ kind: 'supply', label }));
  const room = Math.max(0, INVENTORY_SIZE - supplyCells.length);
  const placed = switches.slice(0, room).map((itemId): InvCell => ({ kind: 'item', itemId }));
  const inventory = [...placed, ...supplyCells].slice(0, INVENTORY_SIZE);
  while (inventory.length < INVENTORY_SIZE) inventory.push(null);
  return { worn, inventory, overflow: Math.max(0, switches.length - room) };
};
