// Worker-safe: no state, React or app imports.
import type { InvCell, Layout, WornSlot } from '@/raid/lib/layout';

type Slot = { id: number } | null;
interface SetupJson {
  eq?: Slot[];
  inv?: Slot[];
  qv?: Slot[];
  afi?: Record<string, { id: number }>;
}

const isSetup = (v: unknown): v is SetupJson => !!v && typeof v === 'object'
  && (Array.isArray((v as SetupJson).eq) || Array.isArray((v as SetupJson).inv));

/**
 * The item ids in a RuneLite Inventory Setups export (worn, inventory, quiver and additional filtered items), without
 * duplicates. Accepts the whole export or its `setup` object.
 */
export const parseInventorySetup = (text: string): number[] => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('Not an Inventory Setups export');
  }
  const setup = isSetup(raw) ? raw : (raw as { setup?: unknown } | null)?.setup;
  if (!isSetup(setup)) throw new Error('Not an Inventory Setups export');

  const ids = [...(setup.eq ?? []), ...(setup.inv ?? []), ...(setup.qv ?? [])]
    .filter((s): s is { id: number } => !!s && typeof s.id === 'number')
    .map((s) => s.id);
  Object.values(setup.afi ?? {}).forEach((s) => {
    if (s && typeof s.id === 'number') ids.push(s.id);
  });
  return [...new Set(ids)];
};

// the plugin's equipment list follows the game's slot numbers: the gaps are the arms, hair and jaw slots
const EQUIPMENT_SLOTS: (WornSlot | null)[] = ['head', 'cape', 'neck', 'weapon', 'body', 'shield', null, 'legs', null, 'hands', 'feet', null, 'ring', 'ammo'];
const SUPPLY_IDS: Partial<Record<string, number>> = { Brew: 6685, Restore: 3024, 'Rune pouch': 12791 }; // the 4-dose potions

const item = (id: number | undefined): Slot => (id === undefined ? null : { id });
const cellItem = (cell: InvCell): Slot => {
  if (cell === null) return null;
  // reserved cells stand for any boost potion, so they stay empty
  return item(cell.kind === 'item' ? cell.itemId : SUPPLY_IDS[cell.label]);
};

/** The layout as a RuneLite Inventory Setups export, in the plugin's own format (tests/raid/fixtures/tfaSetup.json); a quantity of 1 is left out, as it does */
export const exportInventorySetup = (layout: Layout, name: string): string => JSON.stringify({
  setup: {
    name,
    hc: '#FFFF0000',
    eq: EQUIPMENT_SLOTS.map((slot) => (slot ? item(layout.worn[slot]) : null)),
    inv: layout.inventory.map(cellItem),
    ...(layout.worn.quiverAmmo !== undefined ? { qv: [item(layout.worn.quiverAmmo)] } : {}),
  },
});
