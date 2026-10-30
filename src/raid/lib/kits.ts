/**
 * Plans a raid loadout the way players gear for one: a kit (the armour) per style group and weapons that share it.
 * The searches ran per phase, so each phase found its own best setup (void here, Masori there); combining those whole
 * setups filled the switches with overlapping sets. Here every kit is scored with every weapon of its group on every
 * phase (real DPS from the rows pool), then the best kit per group and the weapons to bring are picked within the budget
 * and the item count. Main thread only (basePlayer imports '@/state').
 */
import {
  AmmoApplicability, ammoApplicability, availableEquipment, getCanonicalItemId,
} from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { EquipmentPiece, Player } from '@/types/Player';
import { Gear } from '@/best/lib/search';
import { scoreKind, styleScore, WeaponJob } from '@/best/lib/candidates';
import { BestStyle } from '@/best/types';
import { BulkMonster } from '@/bulk/types';
import { Candidate, fromStored, toStored } from '@/raid/lib/candidates';
import {
  LIGHTBEARER, mainSetup, NO_SETUP_DPS, orderedItems, PhasePick, RaidPlan, wearsLightbearer, yieldToBrowser,
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
  /** Items the search may use: their best off-hands are tried with every one-handed weapon */
  pool?: EquipmentPiece[];
}

type Group = 'melee' | 'ranged' | 'magic';
const groupOf = (style: BestStyle): Group => (style === 'ranged' || style === 'magic' ? style : 'melee');

// kits kept per phase: cheapest to best, so a small budget still has options; every distinct weapon is kept, since
// one best on its own phases (the Twisted bow) must not lose to a cheaper one best on others
const KITS_PER_PHASE = 3;
// as in the assembly: free upgrades first, but tiny gains don't win on price alone
const COST_SMOOTHING = 100_000;
const MIN_GAIN = 1e-6;
// rounds of adding weapons and swapping one
const MAX_ROUNDS = 10;
// off-hands of the pool tried with each one-handed weapon, besides the searched ones
const POOL_SHIELDS = 2;

interface Kit {
  group: Group;
  gear: Gear;
  items: number[];
  cost: number;
}

/** A weapon with what it fires and, when one-handed, its off-hand: the off-hand belongs to the weapon, not the kit */
interface Weapon {
  group: Group;
  style: BestStyle;
  job: WeaponJob;
  ammoId: number | null;
  shieldId: number | null;
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
  const weapons = new Map<string, Omit<Weapon, 'shieldId'>>();
  // per group the off-hands the searches wore
  const searchedShields = new Map<Group, Set<number>>();
  input.candidates.forEach((c) => {
    const stored = toStored(c.setup, c.style, c.dps);
    const group = groupOf(c.style);
    const { ammo, shield, ...searched } = stored.gear;
    if (typeof shield === 'number') searchedShields.set(group, (searchedShields.get(group) ?? new Set()).add(shield));
    const gear = wearsLightbearer(c.style) ? { ...searched, ring: LIGHTBEARER } : searched;
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
    // a blowpipe's darts are loaded in it: not an item of the loadout
    const weaponItems = canonical([stored.job.weaponId, ammo]);
    const weaponKey = `${group}:${stored.job.weaponId}:${ammo ?? ''}:${stored.job.combatStyle.name}:${stored.job.spellName ?? ''}`;
    if (!weapons.has(weaponKey)) {
      weapons.set(weaponKey, {
        group, style: c.style, job: stored.job, ammoId: ammo ?? null, items: weaponItems, cost: costOf(weaponItems),
      });
    }
  });
  const groups = [...new Set([...kits.values()].map((k) => k.group))];
  // a weapon brought anyway (the spec weapon, with its ammo) is a mainhand option too, in every kit of its style
  const requiredAmmo = required.filter((r) => availableEquipment.find((e) => e.id === r)?.slot === 'ammo');
  required.forEach((weaponId) => {
    const weapon = availableEquipment.find((e) => e.id === weaponId);
    if (weapon?.slot !== 'weapon') return;
    const stances = getCombatStylesForCategory(weapon.category);
    const ammoFor = requiredAmmo.find((a) => ammoApplicability(weaponId, a) === AmmoApplicability.INCLUDED) ?? null;
    if (ammoFor === null && ammoApplicability(weaponId, undefined) !== AmmoApplicability.ALLOWED) return;
    const jobs = groups.flatMap((group) => {
      const combatStyle = group === 'ranged'
        ? stances.find((st) => st.stance === 'Rapid')
        : stances.find((st) => groupOf((st.type ?? 'magic') as BestStyle) === group && st.type !== 'magic' && st.stance === 'Aggressive');
      return combatStyle ? [{ group, style: combatStyle.type as BestStyle, combatStyle }] : [];
    });
    jobs.forEach(({ group, style, combatStyle }) => {
      const weaponKey = `${group}:${weaponId}:${ammoFor ?? ''}:${combatStyle.name}:`;
      if (weapons.has(weaponKey)) return;
      const items = canonical([weaponId, ammoFor]);
      weapons.set(weaponKey, {
        group,
        style,
        job: {
          style, weaponId, combatStyle, ammoId: ammoFor, spellName: null, dartId: null,
        },
        ammoId: ammoFor,
        items,
        cost: costOf(items),
      });
    });
  });
  // each phase's cheap-to-best kits, together
  const keptKits = new Set([...kitStrength.values()].flatMap((strengths) => front([...strengths.keys()], (k) => strengths.get(k)!, KITS_PER_PHASE)));
  const kitsOf = new Map(groups.map((g) => [g, [...keptKits].filter((k) => k.group === g)]));
  // every one-handed weapon with each off-hand worth trying, or none (a slot for the Book of the Dead)
  const poolShields = (input.pool ?? []).filter((e) => e.slot === 'shield');
  const withShields = (w: Omit<Weapon, 'shieldId'>): Weapon[] => {
    const weapon = availableEquipment.find((e) => e.id === w.job.weaponId);
    if (!weapon || weapon.isTwoHanded) return [{ ...w, shieldId: null }];
    const kind = scoreKind(weapon, w.style);
    const value = (e: EquipmentPiece) => {
      const [attack, strength] = styleScore(e, kind);
      return attack + 2 * strength;
    };
    const best = [...poolShields].sort((a, b) => value(b) - value(a)).slice(0, POOL_SHIELDS).map((e) => e.id);
    const shields = canonical([...(searchedShields.get(w.group) ?? []), ...best]);
    return [null, ...shields].map((shieldId) => {
      const items = canonical([...w.items, shieldId]);
      return {
        ...w, shieldId, items, cost: costOf(items),
      };
    });
  };
  const weaponsOf = new Map(groups.map((g) => [g, [...weapons.values()].filter((w) => w.group === g).flatMap(withShields)]));

  // every kit with every weapon of its group, rated on every unit its style can deal
  const combos = new Map<Kit, Map<Weapon, Combo>>();
  let id = 0;
  groups.forEach((g) => kitsOf.get(g)!.forEach((kit) => {
    const byWeapon = new Map<Weapon, Combo>();
    weaponsOf.get(g)!.forEach((w) => {
      const built = fromStored({
        style: w.style, job: w.job, dps: 0, gear: { ...kit.gear, ammo: w.ammoId, shield: w.shieldId },
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

  /** The plan with these kits and weapons: each unit dealt by the fastest weapon that can */
  const evaluate = (chosen: Kit[], taken: { w: Weapon; combo: Combo }[]) => {
    const items = new Set([...required, ...chosen.flatMap((k) => k.items), ...taken.flatMap(({ w }) => w.items)]);
    const best: (Combo | null)[] = units.map(() => null);
    taken.forEach(({ combo }) => units.forEach((_, j) => {
      if (combo.dps[j] > (best[j]?.dps[j] ?? 0)) best[j] = combo;
    }));
    const seconds = units.reduce((n, u, j) => n + secondsAt(u.hp, best[j]?.dps[j] ?? 0), 0);
    return {
      items, cost: costOf(items), best, seconds,
    };
  };

  /**
   * With these kits, adds weapons one at a time while they fit, scored by time saved (per gp when costAware), then
   * swaps a taken weapon for another while that is faster: once the slots are full, a weapon taken early (good
   * everywhere) can block a pair that is faster together
   */
  const withWeapons = (chosen: Kit[], costAware: boolean): Plan => {
    const options = chosen.flatMap((kit) => [...combos.get(kit)!.entries()].map(([w, combo]) => ({ w, combo })));
    let taken: typeof options = [];
    let current = evaluate(chosen, taken);
    const fits = (next: ReturnType<typeof evaluate>) => !((next.cost > current.cost && next.cost > cap)
      || next.items.size > Math.max(maxItems, current.items.size));
    for (let round = 0; round < MAX_ROUNDS; round++) {
      let changed = false;
      for (;;) {
        let pick: { option: typeof options[number]; score: number; next: ReturnType<typeof evaluate> } | null = null;
        for (const option of options) {
          if (taken.includes(option)) continue;
          const next = evaluate(chosen, [...taken, option]);
          if (!fits(next)) continue;
          const gain = current.seconds - next.seconds;
          if (!(gain > MIN_GAIN)) continue;
          const score = costAware ? gain / (Math.max(0, next.cost - current.cost) + COST_SMOOTHING) : gain;
          if (!pick || score > pick.score) pick = { option, score, next };
        }
        if (!pick) break;
        taken = [...taken, pick.option];
        current = pick.next;
        changed = true;
      }
      let swap: { taken: typeof options; next: ReturnType<typeof evaluate> } | null = null;
      for (const out of taken) {
        for (const option of options) {
          if (taken.includes(option)) continue;
          const next = evaluate(chosen, [...taken.filter((t) => t !== out), option]);
          if (!(next.cost <= Math.max(cap, current.cost)) || next.items.size > Math.max(maxItems, current.items.size)) continue;
          if (next.seconds < (swap?.next.seconds ?? current.seconds) - MIN_GAIN) swap = { taken: [...taken.filter((t) => t !== out), option], next };
        }
      }
      if (swap) {
        ({ taken } = swap);
        current = swap.next;
        changed = true;
      }
      if (!changed) break;
    }
    // a kit or weapon no pick uses is left at home
    const used = new Set([...required, ...current.best.flatMap((c) => c?.candidate.itemIds ?? [])]);
    return {
      picks: current.best, seconds: current.seconds, items: used, cost: costOf(used),
    };
  };

  // every choice of one kit (or none) per group
  let tuples: Kit[][] = [[]];
  groups.forEach((g) => {
    tuples = tuples.flatMap((t) => [t, ...kitsOf.get(g)!.map((k) => [...t, k])]);
  });
  let bestPlan: Plan | null = null;
  for (const chosen of tuples) {
    const items = new Set([...required, ...chosen.flatMap((k) => k.items)]);
    if (costOf(items) > cap || items.size > Math.max(maxItems, required.length)) continue;
    for (const costAware of [true, false]) {
      const plan = withWeapons(chosen, costAware);
      if (!bestPlan || plan.seconds < bestPlan.seconds - MIN_GAIN
        || (Math.abs(plan.seconds - bestPlan.seconds) <= MIN_GAIN && plan.cost < bestPlan.cost)) bestPlan = plan;
    }
    // eslint-disable-next-line no-await-in-loop
    await yieldToBrowser();
  }
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
