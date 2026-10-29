/**
 * Plans a raid loadout the way players gear for one: a kit (the armour) per style group and weapons that share it.
 * The searches ran per phase, so each phase found its own best setup (void here, Masori there); combining those whole
 * setups filled the switches with overlapping sets. Here every kit is scored with every weapon of its group on every
 * phase (real DPS from the rows pool), then the best kit per group and the weapons to bring are picked within the budget
 * and the item count. Main thread only (basePlayer imports '@/state').
 */
import { getCanonicalItemId } from '@/lib/Equipment';
import { Player } from '@/types/Player';
import { Gear } from '@/best/lib/search';
import { WeaponJob } from '@/best/lib/candidates';
import { BestStyle } from '@/best/types';
import { BulkMonster } from '@/bulk/types';
import { Candidate, fromStored, toStored } from '@/raid/lib/candidates';
import {
  mainSetup, NO_SETUP_DPS, orderedItems, PhasePick, RaidPlan,
} from '@/raid/lib/assemble';
import { RateFn } from '@/raid/lib/upgrade';

/** One health bar to deal: a phase, or a part of one that only some styles can deal */
export interface KitUnit {
  key: string;
  hp: number;
  /** Styles that can deal it; missing means any */
  styles?: BestStyle[];
}

export interface KitInput {
  units: KitUnit[];
  /** Phase key -> its monster, defence reduction applied */
  monsters: Map<string, BulkMonster>;
  /** Every searched setup */
  candidates: Candidate[];
  priceOf: (id: number) => number;
  budget: number;
  maxItems: number;
  requiredIds: number[];
  extraDps: number;
  playerFor: (style: BestStyle) => Player;
}

type Group = 'melee' | 'ranged' | 'magic';
const groupOf = (style: BestStyle): Group => (style === 'ranged' || style === 'magic' ? style : 'melee');

// kits kept per phase: cheapest to best, so a small budget still has options; every distinct weapon is kept, since
// one best on its own phases (the Twisted bow) must not lose to a cheaper one best on others
const KITS_PER_PHASE = 3;
// as in the assembly: free upgrades first, but tiny gains don't win on price alone
const COST_SMOOTHING = 100_000;
const MIN_GAIN = 1e-6;

interface Kit {
  group: Group;
  gear: Gear;
  items: number[];
  cost: number;
}

interface Weapon {
  group: Group;
  style: BestStyle;
  job: WeaponJob;
  ammoId: number | null;
  items: number[];
  cost: number;
}

/** A kit with a weapon: the setup and its DPS per unit (0 where the weapon's style can't deal the unit) */
interface Combo {
  candidate: Candidate;
  dps: number[];
}

const canonical = (ids: (number | null | undefined)[]) => [...new Set(ids.filter((id): id is number => typeof id === 'number').map(getCanonicalItemId))];

/** Up to `n` options from cheap to strong: the cost/strength front (no option both dearer and weaker), thinned evenly */
const front = <T extends { cost: number }>(options: T[], strength: (o: T) => number, n: number): T[] => {
  const sorted = [...options].sort((a, b) => a.cost - b.cost || strength(b) - strength(a));
  const kept: T[] = [];
  sorted.forEach((o) => {
    if (kept.length === 0 || strength(o) > strength(kept[kept.length - 1])) kept.push(o);
  });
  if (kept.length <= n) return kept;
  return Array.from({ length: n }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (n - 1))]);
};

export const planKits = async (input: KitInput, rate: RateFn): Promise<RaidPlan> => {
  const {
    units, monsters, priceOf, budget, maxItems, extraDps,
  } = input;
  const costOf = (ids: Iterable<number>) => [...ids].reduce((n, id) => n + priceOf(id), 0);
  const required = canonical(input.requiredIds);
  const requiredCost = costOf(required);
  const cap = Math.max(budget, requiredCost);

  // how good a candidate is: its DPS against the best found on its phase
  const bestOnPhase = new Map<string, number>();
  input.candidates.forEach((c) => bestOnPhase.set(c.phaseKey, Math.max(bestOnPhase.get(c.phaseKey) ?? 0, c.dps)));
  const relative = (c: Candidate) => c.dps / (bestOnPhase.get(c.phaseKey) || 1);

  // kits and weapons out of the searched setups
  const kits = new Map<string, Kit>();
  // per phase and group, each kit's best strength there
  const kitStrength = new Map<string, Map<Kit, number>>();
  const weapons = new Map<string, Weapon>();
  input.candidates.forEach((c) => {
    const stored = toStored(c.setup, c.style, c.dps);
    const group = groupOf(c.style);
    const { ammo, ...gear } = stored.gear;
    const kitItems = canonical(Object.values(gear));
    const kitKey = `${group}:${[...kitItems].sort((a, b) => a - b).join(',')}`;
    if (!kits.has(kitKey)) {
      kits.set(kitKey, {
        group, gear, items: kitItems, cost: costOf(kitItems),
      });
    }
    const kit = kits.get(kitKey)!;
    const phaseKey = `${c.phaseKey}:${group}`;
    const strengths = kitStrength.get(phaseKey) ?? new Map<Kit, number>();
    strengths.set(kit, Math.max(strengths.get(kit) ?? 0, relative(c)));
    kitStrength.set(phaseKey, strengths);
    const weaponItems = canonical([stored.job.weaponId, ammo, stored.job.dartId]);
    const weaponKey = `${group}:${stored.job.weaponId}:${ammo ?? ''}:${stored.job.combatStyle.name}:${stored.job.spellName ?? ''}`;
    if (!weapons.has(weaponKey)) {
      weapons.set(weaponKey, {
        group, style: c.style, job: stored.job, ammoId: ammo ?? null, items: weaponItems, cost: costOf(weaponItems),
      });
    }
  });
  const groups = [...new Set([...kits.values()].map((k) => k.group))];
  // each phase's cheap-to-best kits, together
  const keptKits = new Set([...kitStrength.values()].flatMap((strengths) => front([...strengths.keys()], (k) => strengths.get(k)!, KITS_PER_PHASE)));
  const kitsOf = new Map(groups.map((g) => [g, [...keptKits].filter((k) => k.group === g)]));
  const weaponsOf = new Map(groups.map((g) => [g, [...weapons.values()].filter((w) => w.group === g)]));

  // every kit with every weapon of its group, rated on every unit its style can deal
  const combos = new Map<Kit, Map<Weapon, Combo>>();
  let id = 0;
  groups.forEach((g) => kitsOf.get(g)!.forEach((kit) => {
    const byWeapon = new Map<Weapon, Combo>();
    weaponsOf.get(g)!.forEach((w) => {
      const built = fromStored({
        style: w.style, job: w.job, dps: 0, gear: { ...kit.gear, ammo: w.ammoId },
      }, 'kit', input.playerFor(w.style));
      if (!built) return;
      id += 1;
      byWeapon.set(w, { candidate: { ...built, setup: { ...built.setup, id: `kit-${id}` } }, dps: units.map(() => 0) });
    });
    combos.set(kit, byWeapon);
  }));
  const allCombos = [...combos.values()].flatMap((m) => [...m.entries()]);
  const keys = [...new Set(units.map((u) => u.key))];
  await Promise.all(keys.map(async (key) => {
    const monster = monsters.get(key);
    if (!monster) return;
    const rated = allCombos.filter(([w]) => units.some((u) => u.key === key && (!u.styles || u.styles.includes(w.style))));
    const dps = await rate(rated.map(([, c]) => c.candidate.setup), monster);
    rated.forEach(([w, c], i) => units.forEach((u, j) => {
      // eslint-disable-next-line no-param-reassign
      if (u.key === key && (!u.styles || u.styles.includes(w.style))) c.dps[j] = dps[i];
    }));
  }));

  const secondsAt = (hp: number, dps: number) => hp / Math.max(dps + extraDps, NO_SETUP_DPS);

  interface Plan {
    picks: (Combo | null)[];
    seconds: number;
    items: Set<number>;
    cost: number;
  }

  /** With these kits, adds weapons one at a time while they fit, scored by time saved (per gp when costAware) */
  const withWeapons = (chosen: Kit[], costAware: boolean): Plan => {
    const items = new Set([...required, ...chosen.flatMap((k) => k.items)]);
    let cost = costOf(items);
    const best: (Combo | null)[] = units.map(() => null);
    const bestDps = units.map(() => 0);
    let total = units.reduce((n, u) => n + secondsAt(u.hp, 0), 0);
    const options = chosen.flatMap((kit) => [...combos.get(kit)!.entries()].map(([w, combo]) => ({ w, combo })));
    const taken = new Set<Weapon>();
    for (;;) {
      let pick: { w: Weapon; combo: Combo; score: number; seconds: number; cost: number; items: Set<number> } | null = null;
      for (const { w, combo } of options) {
        if (taken.has(w)) continue;
        const next = new Set([...items, ...w.items]);
        const nextCost = costOf(next);
        if ((nextCost > cost && nextCost > cap) || next.size > Math.max(maxItems, items.size)) continue;
        const seconds = units.reduce((n, u, j) => n + secondsAt(u.hp, Math.max(bestDps[j], combo.dps[j])), 0);
        const gain = total - seconds;
        if (!(gain > MIN_GAIN)) continue;
        const score = costAware ? gain / (Math.max(0, nextCost - cost) + COST_SMOOTHING) : gain;
        if (!pick || score > pick.score) {
          pick = {
            w, combo, score, seconds, cost: nextCost, items: next,
          };
        }
      }
      if (!pick) break;
      taken.add(pick.w);
      pick.items.forEach((x) => items.add(x));
      ({ cost } = pick);
      total = pick.seconds;
      units.forEach((_, j) => {
        if (pick!.combo.dps[j] > bestDps[j]) {
          bestDps[j] = pick!.combo.dps[j];
          best[j] = pick!.combo;
        }
      });
    }
    // a kit no pick uses is left at home
    const used = new Set([...required, ...best.flatMap((c) => c?.candidate.itemIds ?? [])]);
    return {
      picks: best, seconds: total, items: used, cost: costOf(used),
    };
  };

  // every choice of one kit (or none) per group
  let tuples: Kit[][] = [[]];
  groups.forEach((g) => {
    tuples = tuples.flatMap((t) => [t, ...kitsOf.get(g)!.map((k) => [...t, k])]);
  });
  let bestPlan: Plan | null = null;
  tuples.forEach((chosen) => {
    const items = new Set([...required, ...chosen.flatMap((k) => k.items)]);
    if (costOf(items) > cap || items.size > Math.max(maxItems, required.length)) return;
    [true, false].forEach((costAware) => {
      const plan = withWeapons(chosen, costAware);
      if (!bestPlan || plan.seconds < bestPlan.seconds - MIN_GAIN
        || (Math.abs(plan.seconds - bestPlan.seconds) <= MIN_GAIN && plan.cost < bestPlan.cost)) bestPlan = plan;
    });
  });
  const chosen = bestPlan ?? withWeapons([], true);

  const picks: PhasePick[] = units.map((u, j) => {
    const combo = chosen.picks[j];
    const candidate = combo ? { ...combo.candidate, phaseKey: u.key, dps: combo.dps[j] } : null;
    return {
      key: u.key, hp: u.hp, candidate, seconds: secondsAt(u.hp, combo?.dps[j] ?? 0),
    };
  });
  const itemIds = orderedItems(picks, required);
  return {
    itemIds,
    cost: costOf(itemIds),
    totalSeconds: picks.reduce((n, p) => n + p.seconds, 0),
    picks,
    overBudget: requiredCost > budget,
    main: mainSetup(picks),
  };
};
