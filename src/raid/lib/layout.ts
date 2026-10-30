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

/**
 * Placeholder potions shown in the reserved slots, in order: a divine and a regular super combat, a ranging and a
 * divine ranging potion; fewer slots drop the regular ones first, more add divine super combats
 */
export const reservedPotions = (n: number): string[] => {
  const extra = Array<string>(Math.max(0, n - 3)).fill('Divine super combat potion');
  if (n >= 4) return [...extra, 'Super combat potion', 'Ranging potion', 'Divine ranging potion'];
  return ['Divine super combat potion', 'Super combat potion', 'Divine ranging potion'].filter((_, i) => n === 3 || i !== 1).slice(0, n);
};

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
 * The loadout as worn gear and a 28-slot inventory: `main`'s gear is worn, a switch fills each slot it leaves empty
 * (the shield slot only beside a one-handed weapon), and an ammo switch the quiver slot when a Dizana's quiver (or its
 * max cape) is brought; every other item is an inventory switch, in `itemIds` order, followed by any
 * empty cells, restores, brews, reserved slots (the bottom row from the left) and the rune pouch in the last cell. Switches that don't fit are counted in `overflow`, supplies never.
 */
export const layoutLoadout = (itemIds: number[], main: BulkSetup | null, supplies: Supplies, magic: MagicOption): Layout => {
  const worn: Layout['worn'] = {};
  GEAR_SLOT_ORDER.forEach((slot) => {
    const item = main?.player.equipment[slot];
    if (item) worn[slot] = item.id;
  });
  const wornIds = new Set(Object.values(worn).map(getCanonicalItemId));
  let switches = itemIds.filter((id) => !wornIds.has(getCanonicalItemId(id)));

  // ammo is never an inventory switch while a slot can hold it: an empty ammo slot first, then the quiver's (shown like
  // the game does, its stored ammo next to the worn one, whether the quiver is worn or a switch: it keeps its ammo)
  const nextAmmo = () => {
    const ammo = switches.find((id) => itemById(id)?.slot === 'ammo');
    if (ammo !== undefined) switches = switches.filter((id) => id !== ammo);
    return ammo;
  };
  if (worn.ammo === undefined) {
    const ammo = nextAmmo();
    if (ammo !== undefined) worn.ammo = ammo;
  }
  // any other empty worn slot holds a switch too (the Book of the Dead beside a one-handed weapon): a slot saved
  const twoHanded = main?.player.equipment.weapon?.isTwoHanded ?? false;
  if (main) {
    GEAR_SLOT_ORDER.forEach((slot) => {
      if (slot === 'ammo' || slot === 'weapon' || worn[slot] !== undefined || (slot === 'shield' && twoHanded)) return;
      const item = switches.find((id) => itemById(id)?.slot === slot);
      if (item === undefined) return;
      worn[slot] = item;
      switches = switches.filter((id) => id !== item);
    });
  }
  const quiver = [worn.cape, ...switches].some((id) => id !== undefined && itemById(id)?.name.includes('Dizana\'s'));
  if (quiver) {
    const ammo = nextAmmo();
    if (ammo !== undefined) worn.quiverAmmo = ammo;
  }

  const supplyCells: InvCell[] = [
    ...Array<SupplyLabel>(supplies.restores).fill('Restore'),
    ...Array<SupplyLabel>(supplies.brews).fill('Brew'),
    ...Array<SupplyLabel>(supplies.reserved).fill('Reserved'),
    ...Array<SupplyLabel>(runePouchSlots(magic)).fill('Rune pouch'),
  ].map((label) => ({ kind: 'supply', label }));
  const room = Math.max(0, INVENTORY_SIZE - supplyCells.length);
  const placed = switches.slice(0, room).map((itemId): InvCell => ({ kind: 'item', itemId }));
  // empty cells sit between the switches and the supplies, the reserved slots and the rune pouch on the bottom row
  const empty = Array<InvCell>(Math.max(0, room - placed.length)).fill(null);
  const inventory = [...placed, ...empty, ...supplyCells].slice(-INVENTORY_SIZE);
  return { worn, inventory, overflow: Math.max(0, switches.length - room) };
};

/** The layout with the fewest switches in the inventory, wearing one of `mains` (the first of equally good ones) */
export const slotEfficientLayout = (itemIds: number[], mains: BulkSetup[], supplies: Supplies, magic: MagicOption): Layout => {
  const switchCount = (l: Layout) => l.overflow + l.inventory.filter((c) => c?.kind === 'item').length;
  return mains.map((main) => layoutLoadout(itemIds, main, supplies, magic))
    .reduce<Layout | null>((best, l) => (!best || switchCount(l) < switchCount(best) ? l : best), null)
    ?? layoutLoadout(itemIds, null, supplies, magic);
};
