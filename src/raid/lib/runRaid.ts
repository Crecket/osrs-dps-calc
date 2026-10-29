/**
 * The raid gear pipeline: route phases, price tiers, candidate searches (cached), assembly and layout. Main thread
 * only (basePlayer imports '@/state').
 */
import { getCanonicalItemId } from '@/lib/Equipment';
import { BestRunDeps, runBestSetup } from '@/best/lib/run';
import { bestPool } from '@/best/lib/candidates';
import {
  BestInputs, BEST_STYLES, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS,
} from '@/best/types';
import { EquipmentPiece } from '@/types/Player';
import { Spellbook } from '@/types/Spell';
import {
  DEFENCE_WEAPON_IDS, DEFENCE_WEAPONS, DefenceCounts, MagicOption, Route,
} from '@/raid/types';
import { raidById } from '@/raid/raids';
import { routeBosses, routePhases } from '@/raid/lib/route';
import { itemPrice, Prices } from '@/raid/lib/prices';
import {
  Candidate, missingSearches, raidCandidates, RaidProgress, tierExclusions,
} from '@/raid/lib/candidates';
import { SearchCache } from '@/raid/lib/searchCache';
import { assembleLoadout, RaidPlan, THRALL_DPS } from '@/raid/lib/assemble';
import {
  freeSwitchSlots, Layout, layoutLoadout, Supplies,
} from '@/raid/lib/layout';

export const BOOK_OF_THE_DEAD = 25818;
// worn slots besides ammo, which a second ammo shares through the quiver
const WORN_SLOTS = 11;

export interface RaidSettings {
  raidId: string;
  route: Route;
  budget: number;
  ownedIds: number[];
  excludedIds: number[];
  /** Per phase key, specs that differ from the phase's defaults */
  counts: Record<string, Partial<DefenceCounts>>;
  supplies: Supplies;
  magic: MagicOption;
  /** Boss rules (required items, forbidden magic) apply */
  rulesOn: boolean;
}

export const defaultSettings = (): RaidSettings => {
  const raid = raidById('fractured-archive');
  return {
    raidId: raid.id,
    route: { ...raid.defaultRoute },
    budget: 100_000_000,
    ownedIds: [],
    excludedIds: [],
    counts: {},
    supplies: { brews: 6, restores: 5, reserved: 4 },
    magic: 'thralls',
    rulesOn: true,
  };
};

/** One route phase as the results show it */
export interface ResultPhase {
  key: string;
  label: string;
  bossId: string;
  bossName: string;
  hp: number;
  counts: DefenceCounts;
}

/** A weapon the loadout can use on a phase, with its best setup's DPS (thralls included) and kill time */
export interface WeaponOption {
  weaponId: number;
  dps: number;
  seconds: number;
}

export interface RaidResult {
  plan: RaidPlan;
  layout: Layout;
  phases: ResultPhase[];
  /** Per phase key, every weapon the loadout can use there, fastest first */
  options: Record<string, WeaponOption[]>;
}

/** Per phase, the best fitting setup of each weapon the loadout holds */
const weaponOptions = (candidates: Candidate[], itemIds: number[], hpByKey: Map<string, number>, extraDps: number) => {
  const held = new Set(itemIds);
  const options: Record<string, WeaponOption[]> = {};
  candidates.filter((c) => c.itemIds.every((id) => held.has(id))).forEach((c) => {
    const weaponId = c.setup.player.equipment.weapon?.id;
    if (weaponId === undefined) return;
    const list = options[c.phaseKey] ?? [];
    const dps = c.dps + extraDps;
    const existing = list.find((o) => o.weaponId === weaponId);
    if (existing && existing.dps >= dps) return;
    const option = { weaponId, dps, seconds: hpByKey.get(c.phaseKey)! / dps };
    options[c.phaseKey] = existing ? list.map((o) => (o === existing ? option : o)) : [...list, option];
  });
  Object.values(options).forEach((list) => list.sort((a, b) => b.dps - a.dps));
  return options;
};

const SPELLBOOKS: Record<MagicOption, Spellbook[]> = {
  thralls: [], none: [], ancients: ['ancient'], standard: ['standard'],
};

/** The best setup search's inputs for the raid: maxed stats, every style, the spellbook the magic option allows */
export const raidBaseInputs = (settings: RaidSettings): BestInputs => ({
  skills: {
    atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
  },
  unlocks: { ...DEFAULT_UNLOCKS },
  conditions: { ...DEFAULT_CONDITIONS },
  potions: {},
  styles: [...BEST_STYLES],
  topN: 1,
  prayerOverrides: {},
  spellbooks: SPELLBOOKS[settings.magic],
});

/** Why the run can't start: a route boss that forbids the magic option, while rules are on */
export const blockReason = (settings: RaidSettings): string | null => {
  if (!settings.rulesOn) return null;
  const boss = routeBosses(raidById(settings.raidId), settings.route)
    .find((b) => b.rules?.forbiddenMagic?.options.includes(settings.magic));
  return boss?.rules?.forbiddenMagic?.reason ?? null;
};

/** Items the loadout must hold: boss requirements (with rules on), defence weapons in use, the book for thralls */
export const requiredItems = (settings: RaidSettings): number[] => {
  const raid = raidById(settings.raidId);
  const excluded = new Set(settings.excludedIds.map(getCanonicalItemId));
  const phases = routePhases(raid, settings.route, settings.counts, settings.excludedIds);
  const ids = [
    ...(settings.rulesOn ? routeBosses(raid, settings.route).flatMap((b) => b.rules?.requiredItemIds ?? []) : []),
    ...DEFENCE_WEAPONS.filter((w) => phases.some((p) => p.counts[w] > 0)).map((w) => DEFENCE_WEAPON_IDS[w]),
    ...(settings.magic === 'thralls' ? [BOOK_OF_THE_DEAD] : []),
  ].map(getCanonicalItemId);
  return [...new Set(ids)].filter((id) => !excluded.has(id));
};

let pool: EquipmentPiece[] | null = null;
const prepare = (settings: RaidSettings, prices: Prices | null) => {
  if (!pool) pool = bestPool();
  const raid = raidById(settings.raidId);
  const phases = routePhases(raid, settings.route, settings.counts, settings.excludedIds);
  const owned = new Set(settings.ownedIds.map(getCanonicalItemId));
  const priceOf = (id: number) => itemPrice(id, prices, owned);
  const excluded = settings.excludedIds.map(getCanonicalItemId);
  const tiers = tierExclusions(settings.budget, priceOf, excluded, pool);
  return {
    phases, priceOf, tiers, base: raidBaseInputs(settings),
  };
};

/** Searches a run would still have to do; 0 means it only re-plans from the cache */
export const searchesNeeded = (settings: RaidSettings, prices: Prices | null, cache: SearchCache): number => {
  const { phases, base, tiers } = prepare(settings, prices);
  return missingSearches(phases, base, tiers, cache);
};

/** Finds the raid loadout: runs the searches that aren't cached, then assembles and lays out the loadout */
export const runRaid = async (
  settings: RaidSettings,
  prices: Prices | null,
  deps: BestRunDeps,
  onProgress: (p: RaidProgress) => void,
  cache: SearchCache,
  search: typeof runBestSetup = runBestSetup,
): Promise<RaidResult> => {
  const {
    phases, priceOf, tiers, base,
  } = prepare(settings, prices);
  const candidates = await raidCandidates(phases, base, tiers, deps, onProgress, cache, search);
  const extraDps = settings.magic === 'thralls' ? THRALL_DPS : 0;
  const plan = assembleLoadout({
    phases: phases.map((p) => ({ key: p.phase.key, hp: p.monster.monster.skills.hp })),
    candidates,
    priceOf,
    budget: settings.budget,
    requiredIds: requiredItems(settings),
    maxItems: WORN_SLOTS + freeSwitchSlots(settings.supplies, settings.magic),
    extraDps,
  });
  const hpByKey = new Map(phases.map((p) => [p.phase.key, p.monster.monster.skills.hp]));
  return {
    plan,
    layout: layoutLoadout(plan.itemIds, plan.main?.setup ?? null, settings.supplies, settings.magic),
    phases: phases.map((p) => ({
      key: p.phase.key,
      label: p.phase.label,
      bossId: p.boss.id,
      bossName: p.boss.name,
      hp: p.monster.monster.skills.hp,
      counts: p.counts,
    })),
    options: weaponOptions(candidates, plan.itemIds, hpByKey, extraDps),
  };
};
