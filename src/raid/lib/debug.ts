/**
 * A compact, readable report of a raid run for debugging: the settings and every pick, item, option and tier by
 * name, without the full player objects.
 */
import { availableEquipment } from '@/lib/Equipment';
import { EquipmentPiece } from '@/types/Player';
import { GEAR_SLOT_ORDER } from '@/bulk/types';
import { RaidResult, RaidSettings } from '@/raid/lib/runRaid';

let itemsById: Map<number, EquipmentPiece> | null = null;
const nameOf = (id: number | null | undefined): string => {
  if (id === null || id === undefined) return '';
  if (!itemsById) itemsById = new Map(availableEquipment.map((e) => [e.id, e]));
  return itemsById.get(id)?.name ?? String(id);
};
const round = (n: number) => Math.round(n * 100) / 100;

// eslint-disable-next-line import/prefer-default-export
export const debugReport = (settings: RaidSettings, result: RaidResult): object => ({
  settings: {
    ...settings,
    ownedIds: settings.ownedIds.map(nameOf),
    excludedIds: settings.excludedIds.map(nameOf),
    bringIds: settings.bringIds.map(nameOf),
    bestDart: settings.bestDart === null ? null : nameOf(settings.bestDart),
  },
  totalSeconds: round(result.plan.totalSeconds),
  cost: result.plan.cost,
  items: result.plan.itemIds.map(nameOf),
  worn: Object.fromEntries(Object.entries(result.layout.worn).map(([slot, id]) => [slot, nameOf(id)])),
  inventory: result.layout.inventory.map((c) => {
    if (!c) return null;
    return c.kind === 'item' ? nameOf(c.itemId) : c.label;
  }),
  overflow: result.layout.overflow,
  picks: result.plan.picks.map((p) => {
    const player = p.candidate?.setup.player;
    return {
      phase: p.key,
      hp: p.hp,
      seconds: round(p.seconds),
      weapon: nameOf(player?.equipment.weapon?.id),
      style: p.candidate?.style ?? null,
      stance: player?.style.stance ?? null,
      spell: player?.spell?.name ?? null,
      dps: p.candidate ? round(p.candidate.dps) : 0,
      gear: player ? Object.fromEntries(GEAR_SLOT_ORDER.filter((s) => player.equipment[s]).map((s) => [s, nameOf(player.equipment[s]?.id)])) : {},
    };
  }),
  options: Object.fromEntries(Object.entries(result.options).map(([key, list]) => [key, list.map((o) => ({
    weapon: nameOf(o.weaponId), dps: round(o.dps), seconds: round(o.seconds),
  }))])),
  tiers: Object.fromEntries(Object.entries(result.tiers ?? {}).map(([key, list]) => [key, list.map((t) => ({
    weapon: nameOf(t.weaponId), style: t.style, dps: round(t.dps), seconds: round(t.seconds), cost: t.cost, held: t.held,
  }))])),
  specs: Object.fromEntries(Object.entries(result.specs ?? {}).map(([key, list]) => [key, list.slice(0, 5).map((sp) => ({
    weapon: nameOf(sp.weaponId), ammo: nameOf(sp.ammoId), cost: sp.cost, expected: round(sp.expected), dps: round(sp.dps),
  }))])),
});
