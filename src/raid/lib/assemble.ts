/**
 * Picks a raid loadout from candidate setups: the items to bring so the route's total kill time is lowest within the
 * budget and the item count. Pure arithmetic over precomputed DPS; nothing here calls the engine.
 */
import { Candidate } from '@/raid/lib/candidates';

/** Flat DPS of a greater thrall: max hit 3 every 4 ticks, always hits */
export const THRALL_DPS = 0.625;
/** Seconds a phase counts for when nothing in the loadout can kill it */
export const NO_SETUP_SECONDS = 600;
/** Most expensive items that get a forced and a banned start each */
export const KEY_ITEMS = 5;
// added to a step's cost in the cost-aware pass, so free upgrades go first but tiny gains don't win on price alone
const COST_SMOOTHING = 100_000;
const MAX_POLISH_SWEEPS = 5;
const MIN_GAIN = 1e-6;

export interface AssembleInput {
  phases: { key: string; hp: number }[];
  candidates: Candidate[];
  priceOf: (id: number) => number;
  budget: number;
  /** Items the loadout must hold, whatever they cost */
  requiredIds: number[];
  /** Most distinct items the loadout may hold, worn and carried */
  maxItems: number;
  /** Damage that comes on top of every setup, e.g. thralls */
  extraDps: number;
}

export interface PhasePick {
  key: string;
  candidate: Candidate | null;
  seconds: number;
}

export interface RaidPlan {
  /** In order of first use along the route, then required items */
  itemIds: number[];
  cost: number;
  totalSeconds: number;
  picks: PhasePick[];
  /** The required items alone cost more than the budget */
  overBudget: boolean;
  /** The setup used for the most time, worn between fights */
  main: Candidate | null;
}

type Mask = Uint32Array;

interface Indexed {
  candidate: Candidate;
  mask: Mask;
  phase: number;
}

const fits = (inner: Mask, outer: Mask) => inner.every((w, i) => (w & ~outer[i]) === 0);
const union = (a: Mask, b: Mask) => a.map((w, i) => w | b[i]);
const has = (m: Mask, bit: number) => (m[bit >>> 5] & (1 << (bit & 31))) !== 0;

export const assembleLoadout = (input: AssembleInput): RaidPlan => {
  const {
    phases, priceOf, budget, maxItems, extraDps,
  } = input;

  // every item as a bit
  const ids: number[] = [];
  const bitOf = new Map<number, number>();
  const addId = (id: number) => {
    if (!bitOf.has(id)) {
      bitOf.set(id, ids.length);
      ids.push(id);
    }
  };
  input.requiredIds.forEach(addId);
  input.candidates.forEach((c) => c.itemIds.forEach(addId));
  const words = Math.max(1, Math.ceil(ids.length / 32));
  const maskOf = (list: number[]) => {
    const m = new Uint32Array(words);
    list.forEach((id) => {
      const b = bitOf.get(id)!;
      m[b >>> 5] |= 1 << (b & 31);
    });
    return m;
  };
  const prices = ids.map(priceOf);
  const costOf = (m: Mask) => ids.reduce((sum, _, b) => (has(m, b) ? sum + prices[b] : sum), 0);
  const countOf = (m: Mask) => ids.reduce((n, _, b) => (has(m, b) ? n + 1 : n), 0);

  // per phase, its candidates best first
  const phaseIndex = new Map(phases.map((p, i) => [p.key, i]));
  const all: Indexed[] = input.candidates
    .filter((c) => phaseIndex.has(c.phaseKey))
    .map((c) => ({ candidate: c, mask: maskOf(c.itemIds), phase: phaseIndex.get(c.phaseKey)! }));
  const byPhase: Indexed[][] = phases.map(() => []);
  all.forEach((c) => byPhase[c.phase].push(c));
  byPhase.forEach((list) => list.sort((a, b) => b.candidate.dps - a.candidate.dps));
  // per item, the phases whose candidates use it: adding it can only change those
  const phasesOfBit: Set<number>[] = ids.map(() => new Set());
  all.forEach((c) => ids.forEach((_, b) => {
    if (has(c.mask, b)) phasesOfBit[b].add(c.phase);
  }));

  const required = maskOf(input.requiredIds);
  const requiredCost = costOf(required);

  const pickFor = (phase: number, m: Mask, banned: Mask | null) => byPhase[phase]
    .find((c) => fits(c.mask, m) && (!banned || !c.mask.some((w, i) => (w & banned[i]) !== 0))) ?? null;
  const secondsFor = (phase: number, pick: Indexed | null) => {
    const dps = (pick?.candidate.dps ?? 0) + extraDps;
    return dps > 0 ? Math.min(phases[phase].hp / dps, NO_SETUP_SECONDS) : NO_SETUP_SECONDS;
  };
  const phaseSeconds = (m: Mask, banned: Mask | null) => phases.map((_, i) => secondsFor(i, pickFor(i, m, banned)));
  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

  /** Adds candidates one at a time, scored by `score(gain, Δcost)`, while they fit the budget and item count */
  const greedy = (start: Mask, banned: Mask | null, costAware: boolean): Mask => {
    let m = start;
    let cost = costOf(m);
    let seconds = phaseSeconds(m, banned);
    const allowed = banned ? all.filter((c) => !c.mask.some((w, i) => (w & banned[i]) !== 0)) : all;
    for (;;) {
      let best: { m: Mask; seconds: number[]; cost: number; score: number } | null = null;
      const tried = new Set<string>();
      for (const c of allowed) {
        if (fits(c.mask, m)) continue;
        const next = union(m, c.mask);
        const key = next.join(',');
        if (tried.has(key)) continue;
        tried.add(key);
        const nextCost = costOf(next);
        const delta = nextCost - cost;
        if ((delta > 0 && nextCost > budget) || countOf(next) > maxItems) continue;
        // only phases whose candidates use an added item can change
        const touched = new Set<number>();
        for (let b = 0; b < ids.length; b++) {
          if (has(c.mask, b) && !has(m, b)) phasesOfBit[b].forEach((p) => touched.add(p));
        }
        const nextSeconds = [...seconds];
        for (const p of touched) nextSeconds[p] = secondsFor(p, pickFor(p, next, banned));
        const gain = sum(seconds) - sum(nextSeconds);
        if (gain <= MIN_GAIN) continue;
        const score = costAware ? gain / (Math.max(0, delta) + COST_SMOOTHING) : gain;
        if (!best || score > best.score) {
          best = {
            m: next, seconds: nextSeconds, cost: nextCost, score,
          };
        }
      }
      if (!best) return m;
      ({ m, seconds, cost } = best);
    }
  };

  /** The loadout trimmed to the required items and what the picks use, with its picks */
  const finish = (m: Mask) => {
    const picks = phases.map((_, i) => pickFor(i, m, null));
    const kept = picks.reduce((acc, p) => (p ? union(acc, p.mask) : acc), required);
    const seconds = picks.map((p, i) => secondsFor(i, p));
    return {
      m: kept, picks, seconds, total: sum(seconds), cost: costOf(kept),
    };
  };
  type Result = ReturnType<typeof finish>;
  // a forced start can begin above the budget; such plans never win
  const cap = Math.max(budget, requiredCost);
  const better = (a: Result, b: Result | null) => a.cost <= cap && (!b || a.total < b.total - MIN_GAIN
    || (Math.abs(a.total - b.total) <= MIN_GAIN && a.cost < b.cost));

  const runBoth = (start: Mask, banned: Mask | null) => {
    const a = finish(greedy(start, banned, true));
    const b = finish(greedy(start, banned, false));
    return better(b, a) ? b : a;
  };

  // starts: the plain one, then each key item forced in and banned
  let best: Result = runBoth(required, null);
  const keyItems = ids
    .map((id, b) => ({ id, b }))
    .filter(({ b }) => !has(required, b) && prices[b] > 0)
    .sort((x, y) => prices[y.b] - prices[x.b])
    .slice(0, KEY_ITEMS);
  keyItems.forEach(({ b }) => {
    const single = new Uint32Array(words);
    single[b >>> 5] |= 1 << (b & 31);
    [runBoth(union(required, single), null), runBoth(required, single)].forEach((r) => {
      if (better(r, best)) best = r;
    });
  });

  // polish: drop the items only one pick uses and refill
  for (let sweep = 0; sweep < MAX_POLISH_SWEEPS; sweep++) {
    let improved = false;
    const distinct = [...new Set(best.picks.filter((p): p is Indexed => !!p))];
    for (const pick of distinct) {
      const others = distinct.filter((p) => p !== pick).reduce((acc, p) => union(acc, p.mask), required);
      const without = best.m.map((w, i) => w & ~(pick.mask[i] & ~others[i]));
      const r = finish(greedy(without, null, true));
      if (better(r, best)) {
        best = r;
        improved = true;
        break;
      }
    }
    if (!improved) break;
  }

  // items in order of first use, then the required ones
  const ordered: number[] = [];
  best.picks.forEach((p) => p?.candidate.itemIds.forEach((id) => {
    if (!ordered.includes(id)) ordered.push(id);
  }));
  input.requiredIds.forEach((id) => {
    if (!ordered.includes(id)) ordered.push(id);
  });

  // main: the setup (by its items) used for the most seconds
  const timeBySetup = new Map<string, { candidate: Candidate; seconds: number }>();
  best.picks.forEach((p, i) => {
    if (!p) return;
    const key = [...p.candidate.itemIds].sort((a, b) => a - b).join(',');
    const entry = timeBySetup.get(key) ?? { candidate: p.candidate, seconds: 0 };
    entry.seconds += best.seconds[i];
    timeBySetup.set(key, entry);
  });
  const main = [...timeBySetup.values()].sort((a, b) => b.seconds - a.seconds)[0]?.candidate ?? null;

  return {
    itemIds: ordered,
    cost: best.cost,
    totalSeconds: best.total,
    picks: phases.map((p, i) => ({ key: p.key, candidate: best.picks[i]?.candidate ?? null, seconds: best.seconds[i] })),
    overBudget: requiredCost > budget,
    main,
  };
};
