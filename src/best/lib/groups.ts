/**
 * Groups a style's results by weapon for the page: each weapon's first row in the current sort ranks, the rest are its
 * alternatives, described by the gear they swap in.
 */
import { BulkRow, BulkSetup, GEAR_SLOT_ORDER } from '@/bulk/types';
import { selectRows, SortState } from '@/bulk/lib/table';
import { PlayerEquipment } from '@/types/Player';

export interface Alternative {
  row: BulkRow;
  /** The slots whose item differs from the weapon's lead row */
  slots: (keyof PlayerEquipment)[];
  /** What it wears instead, e.g. 'With Berserker ring (i), Ferocious gloves' */
  label: string;
}

export interface WeaponGroup {
  weaponId: number | null;
  lead: BulkRow;
  alternatives: Alternative[];
}

const SLOT_NAMES: Partial<Record<keyof PlayerEquipment, string>> = {
  head: 'helmet', neck: 'amulet', hands: 'gloves', feet: 'boots',
};

/** The slots in which `b` wears something other than `a`, in gear order. */
export const differingSlots = (a: BulkSetup, b: BulkSetup): (keyof PlayerEquipment)[] => GEAR_SLOT_ORDER
  .filter((slot) => (a.player.equipment[slot]?.id ?? null) !== (b.player.equipment[slot]?.id ?? null));

const swapLabel = (setup: BulkSetup, slots: (keyof PlayerEquipment)[]) => {
  if (slots.length === 0) return 'Same gear';
  const items = slots.map((slot) => setup.player.equipment[slot]?.name ?? `no ${SLOT_NAMES[slot] ?? slot}`);
  return `With ${items.join(', ')}`;
};

/**
 * The rows in `sort` order, grouped by weapon: groups in the order of their lead (first) row, each lead followed by
 * the weapon's other rows as alternatives.
 */
export const groupByWeapon = (rows: BulkRow[], setups: BulkSetup[], sort: SortState): WeaponGroup[] => {
  const setupsById = new Map(setups.map((s) => [s.id, s]));
  const groups = new Map<number | null, WeaponGroup>();
  selectRows(rows, { mode: 'normal', sort }).forEach((row) => {
    const setup = setupsById.get(row.setupId);
    if (!setup) return;
    const weaponId = setup.player.equipment.weapon?.id ?? null;
    const group = groups.get(weaponId);
    if (!group) {
      groups.set(weaponId, { weaponId, lead: row, alternatives: [] });
      return;
    }
    const slots = differingSlots(setupsById.get(group.lead.setupId)!, setup);
    group.alternatives.push({ row, slots, label: swapLabel(setup, slots) });
  });
  return [...groups.values()];
};
