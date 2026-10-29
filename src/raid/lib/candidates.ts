/**
 * Candidate setups for a raid: the best setup search run per route phase at a few price tiers. Main thread only
 * (basePlayer imports '@/state').
 */
import { getCanonicalItemId } from '@/lib/Equipment';
import { EquipmentPiece, Player } from '@/types/Player';
import { BestPhase, BestRunDeps, runBestSetup } from '@/best/lib/run';
import { buildPlayer, Gear } from '@/best/lib/search';
import { GearSlot } from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import { hashKey } from '@/best/lib/resultCache';
import { BestInputs, BestStyle } from '@/best/types';
import { BulkSetup, GEAR_SLOT_ORDER } from '@/bulk/types';
import { RoutePhase } from '@/raid/types';
import { SearchCache, StoredCandidate } from '@/raid/lib/searchCache';

export interface Candidate {
  phaseKey: string;
  style: BestStyle;
  setup: BulkSetup;
  dps: number;
  /** Canonical ids of every worn item, ammo included */
  itemIds: number[];
}

export interface RaidProgress {
  /** Searches finished in this run, cached ones not counted */
  search: number;
  /** Searches this run has to do */
  searches: number;
  phaseLabel: string;
  /** The current search's own progress */
  inner: { done: number; total: number; phase: BestPhase } | null;
  cached: number;
}

/** Weapons searched per style and phase */
export const RAID_TOP_K = 3;

/**
 * Exclusion lists for the price tiers (the budget, a quarter of it, owned and free items only): the pool's items that
 * cost more than the tier, plus `excluded`. Sorted, duplicates removed.
 */
export const tierExclusions = (
  budget: number,
  priceOf: (id: number) => number,
  excluded: number[],
  pool: EquipmentPiece[],
): number[][] => {
  const seen = new Set<string>();
  return [budget, budget / 4, 0].flatMap((cap) => {
    const ids = [...new Set([...excluded, ...pool.filter((e) => priceOf(e.id) > cap).map((e) => e.id)])].sort((a, b) => a - b);
    const key = ids.join(',');
    if (seen.has(key)) return [];
    seen.add(key);
    return [ids];
  });
};

const SLOTS = GEAR_SLOT_ORDER.filter((s): s is GearSlot => s !== 'weapon');

export const toStored = (setup: BulkSetup, style: BestStyle, dps: number): StoredCandidate => {
  const { player } = setup;
  const weapon = player.equipment.weapon!;
  const gear: Gear = {};
  SLOTS.forEach((slot) => {
    gear[slot] = player.equipment[slot]?.id ?? null;
  });
  return {
    style,
    dps,
    gear,
    job: {
      style,
      weaponId: weapon.id,
      combatStyle: player.style,
      // ammo travels in the gear
      ammoId: null,
      spellName: player.spell?.name ?? null,
      dartId: (weapon.itemVars?.blowpipeDartId as number | undefined) ?? null,
    },
  };
};

/** The stored setup dressed on `base`; null when one of its items is no longer in the data */
export const fromStored = (s: StoredCandidate, phaseKey: string, base: Player): Candidate | null => {
  try {
    const player = buildPlayer(base, s.job, s.gear);
    const worn = GEAR_SLOT_ORDER.map((slot) => player.equipment[slot]).filter((e): e is EquipmentPiece => !!e);
    return {
      phaseKey,
      style: s.style,
      dps: s.dps,
      setup: { id: `${phaseKey}-${s.job.weaponId}`, name: player.equipment.weapon!.name, player },
      itemIds: [...new Set(worn.map((e) => getCanonicalItemId(e.id)))],
    };
  } catch {
    return null;
  }
};

const searchInputs = (base: BestInputs, tier: number[]): BestInputs => ({ ...base, excludedItemIds: tier });

export const searchKey = (phase: RoutePhase, inputs: BestInputs): string => hashKey(JSON.stringify({ monster: phase.monster.monster, inputs }));

/** How many of the searches for these phases and tiers aren't cached yet */
export const missingSearches = (phases: RoutePhase[], base: BestInputs, tiers: number[][], cache: SearchCache): number => phases
  .reduce((n, phase) => n + tiers.filter((tier) => !cache.has(searchKey(phase, searchInputs(base, tier)))).length, 0);

/**
 * Every search's setups with DPS for each phase × tier, from the cache or by running the best setup search (one at a
 * time: a new runBestSetup call cancels the one before).
 */
export const raidCandidates = async (
  phases: RoutePhase[],
  base: BestInputs,
  tiers: number[][],
  deps: BestRunDeps,
  onProgress: (p: RaidProgress) => void,
  cache: SearchCache,
  search: typeof runBestSetup = runBestSetup,
): Promise<Candidate[]> => {
  const searches = missingSearches(phases, base, tiers, cache);
  const cached = phases.length * tiers.length - searches;
  let done = 0;
  const players = new Map<BestStyle, Player>();
  const playerFor = (style: BestStyle) => {
    if (!players.has(style)) players.set(style, basePlayer(base, style));
    return players.get(style)!;
  };

  const out: Candidate[] = [];
  for (const phase of phases) {
    for (const tier of tiers) {
      const inputs = searchInputs(base, tier);
      const key = searchKey(phase, inputs);
      let stored = cache.get(key);
      if (!stored) {
        const phaseLabel = `${phase.boss.name}${phase.boss.phases.length > 1 ? ` — ${phase.phase.label}` : ''}`;
        onProgress({
          search: done, searches, phaseLabel, inner: null, cached,
        });
        const finished = done;
        // eslint-disable-next-line no-await-in-loop
        const outcomes = await search(inputs, phase.monster, deps, (d, total, p) => onProgress({
          search: finished, searches, phaseLabel, inner: { done: d, total, phase: p }, cached,
        }), { topK: RAID_TOP_K });
        stored = outcomes.flatMap((o) => o.setups.map((setup, i) => ({ setup, dps: o.rows[i]?.dps ?? 0, style: o.style })))
          .filter((x) => x.dps > 0)
          .map((x) => toStored(x.setup, x.style, x.dps));
        cache.set(key, stored);
        done += 1;
        onProgress({
          search: done, searches, phaseLabel, inner: null, cached,
        });
      }
      stored.forEach((s) => {
        const c = fromStored(s, phase.phase.key, playerFor(s.style));
        if (c) out.push(c);
      });
    }
  }
  return out;
};
