/**
 * The raid plan's shape and the helpers the planners share (kits.ts plans, upgrade.ts improves). Pure arithmetic;
 * nothing here calls the engine.
 */
import { Candidate } from '@/raid/lib/candidates';

/** Flat DPS of a greater thrall: max hit 3 every 4 ticks, always hits */
export const THRALL_DPS = 0.625;
/**
 * A phase nothing in the loadout can hit counts as killed at this DPS: slower than any real setup, so even a slow
 * setup on a big phase is always worth bringing (a flat penalty below a real kill time made melee look worthless)
 */
export const NO_SETUP_DPS = 0.5;

/** One per phase, or per part of a phase with parts (sharing the phase's key) */
export interface PhasePick {
  key: string;
  /** The HP this pick has to deal: the phase's, or its part's share */
  hp: number;
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

/** The picks' items in order of first use, then the required ones */
export const orderedItems = (picks: PhasePick[], requiredIds: number[]): number[] => {
  const ordered: number[] = [];
  picks.forEach((p) => p.candidate?.itemIds.forEach((id) => {
    if (!ordered.includes(id)) ordered.push(id);
  }));
  requiredIds.forEach((id) => {
    if (!ordered.includes(id)) ordered.push(id);
  });
  return ordered;
};

/** The setup (by its items) used for the most seconds, worn between fights */
export const mainSetup = (picks: PhasePick[]): Candidate | null => {
  const timeBySetup = new Map<string, { candidate: Candidate; seconds: number }>();
  picks.forEach((p) => {
    if (!p.candidate) return;
    const key = [...p.candidate.itemIds].sort((a, b) => a - b).join(',');
    const entry = timeBySetup.get(key) ?? { candidate: p.candidate, seconds: 0 };
    entry.seconds += p.seconds;
    timeBySetup.set(key, entry);
  });
  return [...timeBySetup.values()].sort((a, b) => b.seconds - a.seconds)[0]?.candidate ?? null;
};
