/**
 * Result filters: slot overrides that change what every setup is calculated with, and filters that only change which
 * results are shown. Neither changes the saved setups.
 */
import { availableEquipment } from '@/lib/Equipment';
import { Player, PlayerEquipment, PlayerSkills } from '@/types/Player';
import Potion from '@/enums/Potion';
import { PotionMap } from '@/utils';
import {
  BulkFilters, BulkRow, BulkSetup, GEAR_SLOT_ORDER, StyleGroup,
} from '@/bulk/types';
import { Mode } from '@/bulk/lib/table';
import { setupKey } from '@/bulk/lib/dedupe';

export const STYLE_GROUPS: StyleGroup[] = ['melee', 'ranged', 'magic'];

const STYLE_LABELS: Record<StyleGroup, string> = { melee: 'Melee', ranged: 'Ranged', magic: 'Magic' };

export const styleLabel = (g: StyleGroup) => STYLE_LABELS[g];

export const DEFAULT_FILTERS: BulkFilters = {
  overrides: {},
  potions: null,
  hiddenStyles: [],
  minDps: null,
  showFiltered: false,
};

/**
 * A preset's saved filters, with defaults for anything missing and anything that isn't valid.
 */
export const readFilters = (raw: unknown): BulkFilters => {
  const f = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const overrides: BulkFilters['overrides'] = {};
  if (f.overrides && typeof f.overrides === 'object') {
    for (const [slot, id] of Object.entries(f.overrides)) {
      if (GEAR_SLOT_ORDER.includes(slot as keyof PlayerEquipment) && (id === null || typeof id === 'number')) {
        overrides[slot as keyof PlayerEquipment] = id;
      }
    }
  }
  const potions = Array.isArray(f.potions)
    ? (f.potions as unknown[]).filter((p): p is Potion => typeof p === 'number' && p in PotionMap)
    : null;
  return {
    overrides,
    potions,
    hiddenStyles: Array.isArray(f.hiddenStyles) ? STYLE_GROUPS.filter((g) => (f.hiddenStyles as unknown[]).includes(g)) : [],
    minDps: typeof f.minDps === 'number' && Number.isFinite(f.minDps) ? f.minDps : null,
    showFiltered: typeof f.showFiltered === 'boolean' ? f.showFiltered : DEFAULT_FILTERS.showFiltered,
  };
};

/**
 * The slots an override actually changes for this player: never the weapon, nor the shield next to a two-handed
 * weapon, nor an item id that doesn't exist.
 */
export const overriddenSlots = (player: Player, overrides: BulkFilters['overrides']): (keyof PlayerEquipment)[] => (
  GEAR_SLOT_ORDER.filter((slot) => {
    if (!(slot in overrides) || slot === 'weapon') return false;
    if (slot === 'shield' && player.equipment.weapon?.isTwoHanded) return false;
    const id = overrides[slot];
    return id === null || availableEquipment.some((e) => e.id === id);
  })
);

/**
 * Boosts for a set of potions, the way the calculator computes them: each skill gets the highest boost of any potion.
 */
export const potionBoosts = (potions: Potion[], skills: PlayerSkills): Player['boosts'] => {
  const boosts: Partial<PlayerSkills> = {
    atk: 0, def: 0, magic: 0, prayer: 0, ranged: 0, str: 0, mining: 0, herblore: 0,
  };
  for (const p of potions) {
    for (const [k, v] of Object.entries(PotionMap[p].calculateFn(skills))) {
      const skill = k as keyof PlayerSkills;
      if ((v as number) > (boosts[skill] ?? 0)) boosts[skill] = v as number;
    }
  }
  return boosts as Player['boosts'];
};

/**
 * The setup as it is calculated: a copy with the overridden slots and potions swapped in, or the setup itself when
 * nothing changes.
 */
export const applyOverrides = (setup: BulkSetup, overrides: BulkFilters['overrides'], potions: Potion[] | null = null): BulkSetup => {
  const slots = overriddenSlots(setup.player, overrides);
  if (slots.length === 0 && potions === null) return setup;

  const equipment = { ...setup.player.equipment };
  for (const slot of slots) {
    const id = overrides[slot];
    equipment[slot] = id === null ? null : availableEquipment.find((e) => e.id === id)!;
  }
  const player = { ...setup.player, equipment };
  if (potions !== null) {
    player.buffs = { ...player.buffs, potions: [...potions] };
    player.boosts = { ...player.boosts, ...potionBoosts(potions, player.skills) };
  }
  return { ...setup, player };
};

export const styleGroup = (player: Player): StyleGroup => {
  if (player.style.type === 'ranged') return 'ranged';
  if (player.style.type === 'magic') return 'magic';
  return 'melee';
};

/**
 * Why a result is filtered out, or null when it is shown. Results that failed are never filtered by DPS, so an error
 * can't hide itself.
 */
export const filterReason = (row: BulkRow, setup: BulkSetup, filters: BulkFilters, mode: Mode): string | null => {
  const group = styleGroup(setup.player);
  if (filters.hiddenStyles.includes(group)) return `${styleLabel(group)} hidden`;

  if (filters.minDps !== null && !row.error) {
    const dps = mode === 'spec' ? (row.spec?.dps ?? 0) : row.dps;
    if (dps < filters.minDps) return `Below ${filters.minDps} DPS`;
  }
  return null;
};

/**
 * Setups that are the same as an earlier setup once the overrides are applied (e.g. the Ultor and Bellator versions of a
 * setup when the ring is overridden), mapped to the name of the earlier setup.
 */
export const overrideDuplicates = (
  setups: BulkSetup[],
  overrides: BulkFilters['overrides'],
  potions: Potion[] | null = null,
): Map<string, string> => {
  const duplicates = new Map<string, string>();
  const first = new Map<string, BulkSetup>();
  for (const s of setups) {
    const key = setupKey(applyOverrides(s, overrides, potions).player);
    const earlier = first.get(key);
    if (earlier) duplicates.set(s.id, earlier.name);
    else first.set(key, s);
  }
  return duplicates;
};
