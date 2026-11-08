/**
 * What else could stand in the slot of an item of a raid loadout, in raid time. Main thread: setups are
 * rated through the rows pool like the planner's.
 */
import {
  AmmoApplicability, ammoApplicability, getCanonicalItemId,
} from '@/lib/Equipment';
import { EquipmentPiece, Player } from '@/types/Player';
import { BulkMonster } from '@/bulk/types';
import {
  isCrystalArmour, isCrystalWeapon, scoreKind, styleScore,
} from '@/best/lib/candidates';
import { BestStyle } from '@/best/types';
import { Candidate, fromStored, toStored } from '@/raid/lib/candidates';
import { PhasePick } from '@/raid/lib/assemble';
import type { RateFn } from '@/raid/lib/upgrade';

type Slot = keyof Player['equipment'];

export interface WorthContext {
  picks: PhasePick[];
  /** Per pick, the styles its part of the phase allows; undefined for any */
  styles: (BestStyle[] | undefined)[];
  monsters: Map<string, BulkMonster>;
  extraDps: number;
  rate: RateFn;
  playerFor: (style: BestStyle) => Player;
}

/** An item that could stand in a slot, rated over every setup wearing the current one */
export interface Replacement {
  id: number | null;
  /** Raid time change against the current item: negative is faster */
  delta: number;
  /** The same per boss (the phase key's boss id) */
  byBoss: Record<string, number>;
  price: number;
  held: boolean;
  current: boolean;
}

// the strongest items per slot, by the style's bonuses, that the replacement list rates
const REPLACEMENTS_RATED = 40;

const seconds = (ctx: WorthContext, hp: number, dps: number) => (dps + ctx.extraDps > 0 ? hp / (dps + ctx.extraDps) : Infinity);

/** The picks wearing the item, and the slot it is worn in */
export const wearersOf = (ctx: WorthContext, id: number): { slot: Slot; picks: number[] } | null => {
  const canonical = getCanonicalItemId(id);
  let slot: Slot | null = null;
  const picks: number[] = [];
  ctx.picks.forEach((p, i) => {
    const equipment = p.candidate?.setup.player.equipment;
    if (!equipment) return;
    const worn = (Object.keys(equipment) as Slot[]).find((s) => equipment[s] && getCanonicalItemId(equipment[s]!.id) === canonical);
    if (!worn) return;
    slot = slot ?? worn;
    picks.push(i);
  });
  return slot ? { slot, picks } : null;
};

/** Whether `item` can go in `slot` of the pick's setup */
const fits = (c: Candidate, slot: Slot, item: EquipmentPiece) => {
  const weapon = c.setup.player.equipment.weapon;
  if (slot === 'ammo' && weapon && ammoApplicability(weapon.id, item.id) !== AmmoApplicability.INCLUDED) return false;
  if (slot === 'shield' && weapon?.isTwoHanded) return false;
  return isCrystalWeapon(weapon) || !isCrystalArmour(item);
};

/** The pick's seconds with each of `ids` in `slot` (null empties it); Infinity where the setup can't be built */
const swapSeconds = async (ctx: WorthContext, i: number, slot: Slot, ids: (number | null)[]): Promise<number[]> => {
  const pick = ctx.picks[i];
  const c = pick.candidate!;
  const stored = toStored(c.setup, c.style, c.dps);
  // each its own setup id: the ratings come back by id, and fromStored names every setup of a phase and weapon alike
  const built = ids.map((id, k) => {
    const next = fromStored({ ...stored, gear: { ...stored.gear, [slot]: id } }, pick.key, ctx.playerFor(c.style));
    return next && { ...next, setup: { ...next.setup, id: `${next.setup.id}-swap-${slot}-${k}` } };
  });
  const ok = built.filter((b): b is Candidate => !!b);
  const dps = ok.length ? await ctx.rate(ok.map((b) => b.setup), ctx.monsters.get(pick.key)!) : [];
  let at = 0;
  return built.map((b) => {
    if (!b) return Infinity;
    const d = dps[at];
    at += 1;
    return seconds(ctx, pick.hp, d);
  });
};

/**
 * The items that could stand in the slot of `id`, each rated in every setup wearing it, fastest first: the strongest
 * of the pool by the setups' style, whatever the loadout holds for the slot, and an empty slot. Null for a weapon (its
 * phases' weapon lists show those) or an item no setup wears.
 */
export const itemReplacements = async (
  ctx: WorthContext,
  id: number,
  pool: EquipmentPiece[],
  priceOf: (id: number) => number,
  heldIds: number[],
): Promise<Replacement[] | null> => {
  const wear = wearersOf(ctx, id);
  if (!wear || wear.slot === 'weapon') return null;
  const { slot, picks } = wear;
  const canonical = getCanonicalItemId(id);
  // each wearing setup's style: treads worn ranged and in melee get the melee boots tried as well as the ranged
  const kinds = [...new Set(picks.map((i) => {
    const c = ctx.picks[i].candidate!;
    return scoreKind(c.setup.player.equipment.weapon!, c.style);
  }))];
  const valueIn = (kind: typeof kinds[number]) => (e: EquipmentPiece) => {
    const [attack, strength] = styleScore(e, kind);
    return attack + 2 * strength;
  };
  const held = new Set(heldIds.map(getCanonicalItemId));
  const usable = pool.filter((e) => e.slot === slot && getCanonicalItemId(e.id) !== canonical
    && picks.every((i) => fits(ctx.picks[i].candidate!, slot, e)));
  const options = [
    ...usable.filter((e) => held.has(getCanonicalItemId(e.id))),
    ...kinds.flatMap((kind) => {
      const value = valueIn(kind);
      return usable.filter((e) => !held.has(getCanonicalItemId(e.id))).sort((a, b) => value(b) - value(a)).slice(0, REPLACEMENTS_RATED);
    }),
  ].map((e) => e.id).filter((x, k, all) => all.indexOf(x) === k);
  const ids: (number | null)[] = [id, null, ...options];
  const perPick = await Promise.all(picks.map((i) => swapSeconds(ctx, i, slot, ids)));
  const totals = ids.map((_, k) => perPick.reduce((n, secs) => n + secs[k], 0));
  const bossOf = (key: string) => key.split(':')[0];
  const byBoss = (k: number) => {
    const out: Record<string, number> = {};
    picks.forEach((i, j) => {
      const boss = bossOf(ctx.picks[i].key);
      out[boss] = (out[boss] ?? 0) + perPick[j][k] - perPick[j][0];
    });
    return out;
  };
  return ids.map((x, k): Replacement => ({
    id: x,
    delta: totals[k] - totals[0],
    byBoss: byBoss(k),
    price: x === null ? 0 : priceOf(x),
    held: x !== null && held.has(getCanonicalItemId(x)),
    current: k === 0,
  }))
    .filter((r) => Number.isFinite(r.delta))
    .sort((a, b) => a.delta - b.delta || a.price - b.price);
};
