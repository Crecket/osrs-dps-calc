/**
 * Upgrades a planned raid loadout slot by slot. The assembly only combines whole setups from the searches, so a cheap
 * setup keeps its free filler (a Bonecrusher necklace where a Necklace of anguish fits the budget). This tries better
 * items in each slot of the plan's setups, scores them with real DPS from the rows pool, and keeps the best time saved
 * per gp while the budget and the item count allow. Main thread only (basePlayer imports '@/state').
 */
import {
  AmmoApplicability, ammoApplicability, getCanonicalItemId,
} from '@/lib/Equipment';
import { EquipmentPiece, Player } from '@/types/Player';
import { BestRunDeps } from '@/best/lib/run';
import { GearSlot, scoreKind, styleScore } from '@/best/lib/candidates';
import { hashKey } from '@/best/lib/resultCache';
import { BestStyle } from '@/best/types';
import {
  BulkMonster, BulkSetup, GEAR_SLOT_ORDER,
} from '@/bulk/types';
import { Candidate, fromStored, toStored } from '@/raid/lib/candidates';
import { SearchCache } from '@/raid/lib/searchCache';
import {
  mainSetup, orderedItems, PhasePick, RaidPlan, wearsLightbearer,
} from '@/raid/lib/assemble';

/** DPS of each setup on the monster */
export type RateFn = (setups: BulkSetup[], monster: BulkMonster) => Promise<number[]>;

export interface UpgradeInput {
  plan: RaidPlan;
  /** Phase key -> its monster, defence reduction applied */
  monsters: Map<string, BulkMonster>;
  /** Every searched setup: their items are worth trying in every slot */
  candidates: Candidate[];
  /** Items the search may use */
  pool: EquipmentPiece[];
  priceOf: (id: number) => number;
  budget: number;
  maxItems: number;
  requiredIds: number[];
  /** Canonical ids left out */
  excluded: Set<number>;
  extraDps: number;
  playerFor: (style: BestStyle) => Player;
}

// besides the searched items, the items with the best bonuses for the style tried per slot
const TOP_PER_SLOT = 6;
// as in the assembly's cost-aware pass: free upgrades first, but tiny gains don't win on price alone
const COST_SMOOTHING = 100_000;
const MAX_STEPS = 60;
const MIN_GAIN = 1e-6;
const SLOTS = GEAR_SLOT_ORDER.filter((s): s is GearSlot => s !== 'weapon');

interface Unit {
  pick: PhasePick;
  monster: BulkMonster;
  candidate: Candidate;
}

/** Units wearing the same items: a slot change applies to all of them */
interface Group {
  units: Unit[];
  items: number[];
  moves: Move[];
}

interface Move {
  slot: GearSlot;
  from: number | null;
  to: number;
  /** Per unit of the group, its setup with the item in the slot and that setup's DPS */
  next: Candidate[];
}

/** The item's name without its trailing variant marks: "Avernic treads (pr)(pe)" -> "Avernic treads" */
const familyOf = (e: EquipmentPiece) => e.name.replace(/(\s*\([^)]*\))+$/, '');
/** At least as good as `b` in every offence and bonus */
const covers = (a: EquipmentPiece, b: EquipmentPiece) => (Object.keys(b.offensive) as (keyof EquipmentPiece['offensive'])[])
  .every((k) => a.offensive[k] >= b.offensive[k])
  && (Object.keys(b.bonuses) as (keyof EquipmentPiece['bonuses'])[]).every((k) => a.bonuses[k] >= b.bonuses[k]);

const setKey = (ids: number[]) => [...ids].sort((a, b) => a - b).join(',');
const isBlowpipe = (w: EquipmentPiece) => w.itemVars?.blowpipeDartId !== undefined || /blowpipe/i.test(w.name);

export const upgradeLoadout = async (input: UpgradeInput, rate: RateFn): Promise<RaidPlan> => {
  const {
    plan, monsters, priceOf, budget, maxItems, excluded, extraDps,
  } = input;
  const required = new Set(input.requiredIds);
  const searched = new Set(input.candidates.flatMap((c) => c.itemIds));
  const bySlot = new Map<string, EquipmentPiece[]>();
  input.pool.filter((e) => !excluded.has(getCanonicalItemId(e.id))).forEach((e) => {
    bySlot.set(e.slot, [...(bySlot.get(e.slot) ?? []), e]);
  });

  const groups: Group[] = [];
  plan.picks.forEach((pick) => {
    const monster = monsters.get(pick.key);
    if (!pick.candidate || !monster) return;
    const unit = { pick, monster, candidate: pick.candidate };
    const key = setKey(pick.candidate.itemIds);
    const group = groups.find((g) => setKey(g.items) === key);
    if (group) group.units.push(unit);
    else groups.push({ units: [unit], items: [...pick.candidate.itemIds], moves: [] });
  });

  /** The items worth trying in each slot of the group's setup */
  const tries = (c: Candidate): { slot: GearSlot; item: EquipmentPiece }[] => {
    const weapon = c.setup.player.equipment.weapon!;
    const kind = scoreKind(weapon, c.style);
    const value = (e: EquipmentPiece) => {
      const [attack, strength] = styleScore(e, kind);
      return attack + 2 * strength;
    };
    return SLOTS.flatMap((slot) => {
      if ((slot === 'shield' && weapon.isTwoHanded) || (slot === 'ammo' && isBlowpipe(weapon))
        || (slot === 'ring' && wearsLightbearer(c.style))) return [];
      const current = c.setup.player.equipment[slot];
      let items = (bySlot.get(slot) ?? []).filter((e) => e.id !== current?.id);
      if (slot === 'ammo') items = items.filter((e) => ammoApplicability(weapon.id, e.id) === AmmoApplicability.INCLUDED);
      const top = items.filter((e) => !searched.has(e.id) && (!current || value(e) > value(current)))
        .sort((a, b) => value(b) - value(a))
        .slice(0, TOP_PER_SLOT);
      // and the best cheaper ones: a downgrade that pays for a bigger gain elsewhere
      const cheaper = current ? items.filter((e) => !searched.has(e.id) && !top.includes(e) && priceOf(e.id) < priceOf(current.id))
        .sort((a, b) => value(b) - value(a))
        .slice(0, TOP_PER_SLOT) : [];
      return [...items.filter((e) => searched.has(e.id)), ...top, ...cheaper].map((item) => ({ slot, item }));
    });
  };

  let variant = 0;
  const movesFor = async (group: Group): Promise<Move[]> => {
    const moves = tries(group.units[0].candidate).flatMap(({ slot, item }) => {
      const next = group.units.map((u) => {
        const stored = toStored(u.candidate.setup, u.candidate.style, 0);
        const built = fromStored({ ...stored, gear: { ...stored.gear, [slot]: item.id } }, u.pick.key, input.playerFor(u.candidate.style));
        if (!built) return null;
        variant += 1;
        return { ...built, setup: { ...built.setup, id: `upgrade-${variant}` } };
      });
      if (next.some((n) => n === null)) return [];
      const from = group.units[0].candidate.setup.player.equipment[slot];
      return [{
        slot, from: from ? getCanonicalItemId(from.id) : null, to: getCanonicalItemId(item.id), next: next as Candidate[],
      }];
    });
    // each unit's variants rated on its own monster
    await Promise.all(group.units.map(async (u, i) => {
      const dps = await rate(moves.map((m) => m.next[i].setup), u.monster);
      moves.forEach((m, j) => {
        m.next[i] = { ...m.next[i], dps: dps[j] };
      });
    }));
    return moves;
  };

  for (const group of groups) {
    // eslint-disable-next-line no-await-in-loop
    group.moves = await movesFor(group);
  }

  const seconds = (hp: number, dps: number) => (dps + extraDps > 0 ? hp / (dps + extraDps) : Infinity);
  const loadout = (...swaps: { group: Group; items: number[] }[]) => new Set([
    ...required, ...groups.flatMap((g) => swaps.find((sw) => sw.group === g)?.items ?? g.items),
  ]);
  const gainOf = (group: Group, next: Candidate[]) => group.units
    .reduce((n, u, i) => n + seconds(u.pick.hp, u.candidate.dps) - seconds(u.pick.hp, next[i].dps), 0);
  const swapped = (items: number[], move: Move) => [...items.filter((id) => id !== move.from), move.to];
  const costOf = (ids: Set<number>) => [...ids].reduce((n, id) => n + priceOf(id), 0);

  for (let step = 0; step < MAX_STEPS; step++) {
    const current = loadout();
    const cost = costOf(current);
    const cap = Math.max(budget, cost);
    let best: { group: Group; move: Move; items: number[]; score: number } | null = null;
    for (const group of groups) {
      for (const move of group.moves) {
        const items = swapped(group.items, move);
        const next = loadout({ group, items });
        const nextCost = costOf(next);
        if (nextCost > cap || next.size > Math.max(maxItems, current.size)) continue;
        const gain = gainOf(group, move.next);
        // NaN when a setup does no damage
        if (!(gain > MIN_GAIN)) continue;
        const score = gain / (Math.max(0, nextCost - cost) + COST_SMOOTHING);
        if (!best || score > best.score) {
          best = {
            group, move, items, score,
          };
        }
      }
    }
    if (!best) break;
    const { group, move, items } = best;
    group.units.forEach((u, i) => {
      // eslint-disable-next-line no-param-reassign
      u.candidate = move.next[i];
    });
    group.items = items;
    // eslint-disable-next-line no-await-in-loop
    group.moves = await movesFor(group);
  }

  // with no single change left that fits, two at once: a cheaper item in one slot paying for a bigger gain in another
  // (the Necklace of anguish for a slightly weaker helm). Two changes to one setup are rated together before they count.
  const rejected = new Set<string>();
  for (let step = 0; step < MAX_STEPS; step++) {
    const current = loadout();
    const cap = Math.max(budget, costOf(current));
    // best gain first, so the first pair that fits for each move is its best and the search stops early
    const all = groups.flatMap((group) => group.moves.map((move) => ({ group, move, gain: gainOf(group, move.next) })))
      .filter((m) => Number.isFinite(m.gain))
      .sort((x, y) => y.gain - x.gain);
    const keyOf = (x: typeof all[number], y: typeof all[number]) => `${groups.indexOf(x.group)}:${x.move.slot}:${x.move.to}|${groups.indexOf(y.group)}:${y.move.slot}:${y.move.to}`;
    let best: { a: typeof all[number]; b: typeof all[number]; gain: number } | null = null;
    for (let i = 0; i < all.length - 1; i++) {
      const a = all[i];
      if (a.gain + all[i + 1].gain <= Math.max(MIN_GAIN, best?.gain ?? -Infinity)) break;
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        const gain = a.gain + b.gain;
        if (gain <= Math.max(MIN_GAIN, best?.gain ?? -Infinity)) break;
        if ((a.group === b.group && a.move.slot === b.move.slot) || rejected.has(keyOf(a, b))) continue;
        const next = a.group === b.group
          ? loadout({ group: a.group, items: swapped(swapped(a.group.items, a.move), b.move) })
          : loadout({ group: a.group, items: swapped(a.group.items, a.move) }, { group: b.group, items: swapped(b.group.items, b.move) });
        if (costOf(next) > cap || next.size > Math.max(maxItems, current.size)) continue;
        best = { a, b, gain };
        break;
      }
    }
    if (!best) break;
    const { a, b } = best as { a: typeof all[number]; b: typeof all[number] };
    rejected.add(keyOf(a, b));
    if (a.group === b.group) {
      const { group } = a;
      const first = variant;
      variant += group.units.length;
      const next = group.units.map((u, i) => {
        const stored = toStored(u.candidate.setup, u.candidate.style, 0);
        const built = fromStored({
          ...stored, gear: { ...stored.gear, [a.move.slot]: a.move.next[0].setup.player.equipment[a.move.slot]?.id ?? a.move.to, [b.move.slot]: b.move.next[0].setup.player.equipment[b.move.slot]?.id ?? b.move.to },
        }, u.pick.key, input.playerFor(u.candidate.style));
        return built ? { ...built, setup: { ...built.setup, id: `upgrade-${first + i + 1}` } } : null;
      });
      if (next.some((n) => n === null)) continue;
      // eslint-disable-next-line no-await-in-loop
      const dps = await Promise.all(group.units.map((u, i) => rate([next[i]!.setup], u.monster).then(([d]) => d)));
      const rated = next.map((n, i) => ({ ...n!, dps: dps[i] }));
      if (!(gainOf(group, rated) > MIN_GAIN)) continue;
      group.units.forEach((u, i) => {
        // eslint-disable-next-line no-param-reassign
        u.candidate = rated[i];
      });
      group.items = swapped(swapped(group.items, a.move), b.move);
      // eslint-disable-next-line no-await-in-loop
      group.moves = await movesFor(group);
    } else {
      for (const { group, move } of [a, b]) {
        group.units.forEach((u, i) => {
          // eslint-disable-next-line no-param-reassign
          u.candidate = move.next[i];
        });
        group.items = swapped(group.items, move);
        // eslint-disable-next-line no-await-in-loop
        group.moves = await movesFor(group);
      }
    }
  }

  // variants of one item worn in different setups (Avernic treads (pe) for ranged, (pr) for melee) become the one
  // variant that covers them all, when there is one: one item instead of several, never weaker
  const units = groups.flatMap((g) => g.units);
  const worn = new Map<string, Map<number, EquipmentPiece>>();
  units.forEach((u) => SLOTS.forEach((slot) => {
    const e = u.candidate.setup.player.equipment[slot];
    if (!e) return;
    const key = `${slot}:${familyOf(e)}`;
    worn.set(key, (worn.get(key) ?? new Map()).set(e.id, e));
  }));
  for (const [key, variants] of worn) {
    if (variants.size < 2) continue;
    const slot = key.slice(0, key.indexOf(':')) as GearSlot;
    const family = key.slice(key.indexOf(':') + 1);
    const current = loadout();
    const without = new Set([...current].filter((id) => ![...variants.keys()].some((v) => getCanonicalItemId(v) === id)));
    const merged = (bySlot.get(slot) ?? []).filter((e) => familyOf(e) === family && [...variants.values()].every((v) => covers(e, v)))
      .map((e) => ({ e, cost: costOf(new Set([...without, getCanonicalItemId(e.id)])) }))
      .filter((m) => m.cost <= Math.max(budget, costOf(current)))
      .sort((a, b) => a.cost - b.cost)[0];
    if (!merged) continue;
    const changed = units.filter((u) => variants.has(u.candidate.setup.player.equipment[slot]?.id ?? -1));
    const first = variant;
    variant += changed.length;
    const next = changed.map((u, i) => {
      const stored = toStored(u.candidate.setup, u.candidate.style, 0);
      const built = fromStored({ ...stored, gear: { ...stored.gear, [slot]: merged.e.id } }, u.pick.key, input.playerFor(u.candidate.style));
      return built ? { ...built, setup: { ...built.setup, id: `upgrade-${first + i + 1}` } } : null;
    });
    if (next.some((n) => n === null)) continue;
    // eslint-disable-next-line no-await-in-loop
    const dps = await Promise.all(changed.map((u, i) => rate([next[i]!.setup], u.monster).then(([d]) => d)));
    changed.forEach((u, i) => {
      // eslint-disable-next-line no-param-reassign
      u.candidate = { ...next[i]!, dps: Math.max(dps[i], 0) };
    });
    groups.forEach((g) => {
      // eslint-disable-next-line no-param-reassign
      g.items = [...g.units[0].candidate.itemIds];
    });
  }

  const upgraded = new Map(groups.flatMap((g) => g.units.map((u) => [u.pick, u.candidate] as const)));
  const picks = plan.picks.map((p) => {
    const candidate = upgraded.get(p) ?? p.candidate;
    return candidate === p.candidate ? p : { ...p, candidate, seconds: seconds(p.hp, candidate!.dps) };
  });
  const itemIds = orderedItems(picks, input.requiredIds);
  return {
    ...plan,
    picks,
    itemIds,
    cost: itemIds.reduce((n, id) => n + priceOf(id), 0),
    totalSeconds: picks.reduce((n, p) => n + p.seconds, 0),
    main: mainSetup(picks),
  };
};

const rowKey = (monster: BulkMonster, setup: BulkSetup) => `dps:${hashKey(JSON.stringify({
  monster: monster.monster,
  gear: GEAR_SLOT_ORDER.map((slot) => setup.player.equipment[slot]?.id ?? null),
  dart: setup.player.equipment.weapon?.itemVars?.blowpipeDartId ?? null,
  style: setup.player.style,
  spell: setup.player.spell?.name ?? null,
}))}`;

/** DPS from the rows pool (concurrently with other runs), cached so a re-plan computes nothing again */
export const dpsRater = (deps: BestRunDeps, cache: SearchCache): RateFn => async (setups, monster) => {
  const keys = setups.map((s) => rowKey(monster, s));
  const missing = setups.filter((_, i) => cache.getSpec(keys[i]) === undefined);
  if (missing.length > 0) {
    const rows = await deps.rows.run(missing, [monster], () => {}, { concurrent: true });
    const byId = new Map((rows ?? []).map((r) => [r.setupId, r.dps]));
    missing.forEach((s) => cache.setSpec(rowKey(monster, s), byId.get(s.id) ?? 0));
  }
  return keys.map((k) => cache.getSpec(k) ?? 0);
};
