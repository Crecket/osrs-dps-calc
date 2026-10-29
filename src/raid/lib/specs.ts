/**
 * Special attacks between the defence reduction specs: per room (one boss, energy back to 100% at the start), which
 * spec weapons to use on which phase, and which spec weapons are worth buying. Pure arithmetic over precomputed spec
 * damage.
 */
import { DefenceCounts } from '@/raid/types';

// energy per spec of the defence weapons; a Ralos count is hitsplats, two per 50% spec
const DEFENCE_SPEC_ENERGY: DefenceCounts = { elderMaul: 50, dwh: 50, tonalztic: 25 };
// energy is planned in steps of 5%, which every spec cost is a multiple of
const STEP = 5;
const MIN_GAIN = 1e-6;
// added to a weapon's price when ranking purchases, so cheap weapons don't win on price alone
const COST_SMOOTHING = 100_000;

/** One spec weapon on one phase */
export interface SpecOption {
  weaponId: number;
  /** Spec energy, in % */
  cost: number;
  phaseKey: string;
  /** Expected damage of one spec */
  expected: number;
  /** DPS of the phase's normal setup, which the spec's attack replaces */
  mainDps: number;
  /** How long the spec attack takes */
  attackSeconds: number;
}

export interface SpecPick {
  weaponId: number;
  phaseKey: string;
  count: number;
  /** Seconds the specs save together */
  seconds: number;
}

export interface RoomSpecs {
  picks: SpecPick[];
  seconds: number;
}

export interface SpecRoom {
  bossId: string;
  /** Energy left for specs after the defence reduction */
  energy: number;
  options: SpecOption[];
}

/** Energy left in a room after its phases' defence reduction specs */
export const roomEnergy = (counts: DefenceCounts[]): number => Math.max(0, 100 - counts.reduce(
  (n, c) => n + c.elderMaul * DEFENCE_SPEC_ENERGY.elderMaul + c.dwh * DEFENCE_SPEC_ENERGY.dwh + c.tonalztic * DEFENCE_SPEC_ENERGY.tonalztic,
  0,
));

/** Seconds one spec saves: its damage would take damage / DPS with the normal setup, the spec itself takes its attack */
export const specSaving = (o: SpecOption): number => (o.mainDps > 0 ? o.expected / o.mainDps - o.attackSeconds : 0);

/**
 * The specs that save the most time with `energy`, using only weapons in `held`: an unbounded knapsack over energy,
 * each weapon on the phase where one spec saves the most.
 */
export const planRoomSpecs = (energy: number, options: SpecOption[], held: Set<number>): RoomSpecs => {
  // per weapon, its best phase
  const best = new Map<number, SpecOption>();
  options.filter((o) => held.has(o.weaponId) && o.cost > 0 && specSaving(o) > MIN_GAIN).forEach((o) => {
    const current = best.get(o.weaponId);
    if (!current || specSaving(o) > specSaving(current)) best.set(o.weaponId, o);
  });
  const usable = [...best.values()];
  const steps = Math.floor(energy / STEP);
  // dp[e]: most seconds saved with e steps of energy, and the spec that last got there
  const dp = Array.from({ length: steps + 1 }, () => ({ seconds: 0, last: null as SpecOption | null, from: -1 }));
  for (let e = 1; e <= steps; e++) {
    dp[e] = { ...dp[e - 1], last: null, from: e - 1 };
    usable.forEach((o) => {
      const c = Math.ceil(o.cost / STEP);
      if (c > e) return;
      const seconds = dp[e - c].seconds + specSaving(o);
      if (seconds > dp[e].seconds + MIN_GAIN) dp[e] = { seconds, last: o, from: e - c };
    });
  }
  const counts = new Map<SpecOption, number>();
  for (let e = steps; e > 0; e = dp[e].from) {
    const { last } = dp[e];
    if (last) counts.set(last, (counts.get(last) ?? 0) + 1);
  }
  const picks = [...counts].map(([o, count]) => ({
    weaponId: o.weaponId, phaseKey: o.phaseKey, count, seconds: count * specSaving(o),
  }));
  return { picks, seconds: dp[steps].seconds };
};

const savedWith = (rooms: SpecRoom[], held: Set<number>) => rooms
  .reduce((n, r) => n + planRoomSpecs(r.energy, r.options, held).seconds, 0);

/**
 * Spec weapons to add to the loadout, one at a time by seconds saved per GP, while they fit `budget` (GP left) and
 * `slots` (free inventory slots). Weapons in `held` are already there.
 */
export const buySpecWeapons = (
  rooms: SpecRoom[],
  held: number[],
  priceOf: (id: number) => number,
  budget: number,
  slots: number,
): number[] => {
  const have = new Set(held);
  const bought: number[] = [];
  let left = budget;
  const weapons = [...new Set(rooms.flatMap((r) => r.options.map((o) => o.weaponId)))].filter((id) => !have.has(id));
  while (bought.length < slots) {
    const base = savedWith(rooms, have);
    let pick: { id: number; score: number } | null = null;
    for (const id of weapons) {
      if (have.has(id) || priceOf(id) > left) continue;
      const gain = savedWith(rooms, new Set([...have, id])) - base;
      if (gain <= MIN_GAIN) continue;
      const score = gain / (priceOf(id) + COST_SMOOTHING);
      if (!pick || score > pick.score) pick = { id, score };
    }
    if (!pick) break;
    const { id } = pick;
    have.add(id);
    bought.push(id);
    left -= priceOf(id);
  }
  return bought;
};
