/**
 * The raid gear pipeline: route phases, price tiers, candidate searches (cached), assembly and layout. Main thread
 * only (basePlayer imports '@/state').
 */
import { getCanonicalItemId } from '@/lib/Equipment';
import { BUILD_ID } from '@/lib/build';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { BestRunDeps, runBestSetup } from '@/best/lib/run';
import { bestPool } from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import {
  AccountInputs, BestInputs, BEST_STYLES, BestStyle,
} from '@/best/types';
import { defaultAccount } from '@/best/lib/account';
import { EquipmentPiece, Player } from '@/types/Player';
import { Spellbook } from '@/types/Spell';
import {
  DEFENCE_WEAPON_IDS, DEFENCE_WEAPONS, DefenceCounts, DefenceWeapon, MagicOption, PhasePart, Route,
} from '@/raid/types';
import { raidById } from '@/raid/raids';
import { routeBosses, routePhases } from '@/raid/lib/route';
import { itemPrice, Prices } from '@/raid/lib/prices';
import {
  Candidate, missingSearches, raidCandidates, RaidProgress, tierExclusions,
} from '@/raid/lib/candidates';
import { SearchCache } from '@/raid/lib/searchCache';
import {
  routeSpec, SpecRank, specPrice, specRanking,
} from '@/raid/lib/specs';
import { BulkMonster } from '@/bulk/types';
import {
  mainSetup, NO_SETUP_DPS, orderedItems, RaidPlan, THRALL_DPS,
} from '@/raid/lib/assemble';
import { KitUnit, planKits } from '@/raid/lib/kits';
import { dpsRater, upgradeLoadout } from '@/raid/lib/upgrade';
import {
  freeSwitchSlots, Layout, slotEfficientLayout, Supplies,
} from '@/raid/lib/layout';

export const BOOK_OF_THE_DEAD = 25818;
// the most of the budget the viable setup (kits and weapons for every room) may take, before the spec and drain weapons
export const CORE_SHARE = 0.7;
// the most of the budget the spec weapon may take
export const SPEC_BUDGET_SHARE = 0.3;
// worn slots besides ammo, which a second ammo shares through the quiver
const WORN_SLOTS = 11;
const MAX_REPLANS = 5;

export interface RaidSettings {
  raidId: string;
  route: Route;
  budget: number;
  ownedIds: number[];
  excludedIds: number[];
  /** Items the loadout always holds */
  bringIds: number[];
  /** Levels, prayers, potions and conditions, as on the best setup page */
  account: Required<AccountInputs>;
  /** Per phase key, specs that differ from the phase's defaults */
  counts: Record<string, Partial<DefenceCounts>>;
  supplies: Supplies;
  magic: MagicOption;
  /** Boss rules (required items, forbidden magic) apply */
  rulesOn: boolean;
  /** Styles the searches try */
  styles: BestStyle[];
  /** The strongest blowpipe dart the account can use; null for any */
  bestDart: number | null;
}

/** Stab and magic rarely win in the Archive; leaving them out makes the searches faster */
export const DEFAULT_RAID_STYLES: BestStyle[] = ['slash', 'crush', 'ranged'];

export const defaultSettings = (): RaidSettings => {
  const raid = raidById('fractured-archive');
  return {
    raidId: raid.id,
    route: { ...raid.defaultRoute },
    budget: 500_000_000,
    ownedIds: [],
    excludedIds: [],
    bringIds: [],
    account: defaultAccount(),
    counts: {},
    supplies: { brews: 6, restores: 5, reserved: 4 },
    magic: 'thralls',
    rulesOn: true,
    styles: [...DEFAULT_RAID_STYLES],
    bestDart: null,
  };
};

let darts: EquipmentPiece[] | null = null;
/** The darts a blowpipe can fire, strongest first, one per name */
export const dartOptions = (): EquipmentPiece[] => {
  if (!darts) {
    const all = bestPool().filter((e) => e.slot === 'weapon' && e.category === EquipmentCategory.THROWN && e.name.endsWith(' dart'));
    darts = all.filter((d, i) => all.findIndex((o) => o.name === d.name) === i)
      .sort((a, b) => b.bonuses.ranged_str - a.bonuses.ranged_str);
  }
  return darts;
};

/** The excluded items, and the darts stronger than the best one the account can use */
export const excludedOf = (settings: RaidSettings): number[] => {
  const best = dartOptions().find((d) => d.id === settings.bestDart);
  const stronger = best
    ? bestPool().filter((e) => e.category === EquipmentCategory.THROWN && e.name.endsWith(' dart') && e.bonuses.ranged_str > best.bonuses.ranged_str)
    : [];
  return [...new Set([...settings.excludedIds, ...stronger.map((d) => d.id)].map(getCanonicalItemId))];
};

/** One route phase as the results show it */
export interface ResultPhase {
  key: string;
  label: string;
  bossId: string;
  bossName: string;
  hp: number;
  counts: DefenceCounts;
  /** Shares of the health bar only some styles can deal */
  parts?: PhasePart[];
  /** Styles that can deal the phase; missing means any */
  allowedStyles?: BestStyle[];
}

/** A weapon the loadout can use on a phase, with its best setup's DPS (thralls included) and kill time */
export interface WeaponOption {
  weaponId: number;
  dps: number;
  seconds: number;
  /** How it attacks, e.g. "crush · Smash (Aggressive)"; missing on results saved before it was added */
  attack?: string;
}

/** How a setup attacks: its attack type and stance, or its spell; empty when the setup doesn't say */
export const attackLabel = (player: Player): string => {
  if (player.spell) return `magic · ${player.spell.name}`;
  const { style } = player;
  if (!style) return '';
  return `${style.type ?? 'magic'} · ${style.displayNameOverride ?? style.name} (${style.stance})`;
};

export interface RaidResult {
  /** The build that made the result; missing on results made before builds were recorded */
  build?: string;
  plan: RaidPlan;
  layout: Layout;
  phases: ResultPhase[];
  /** Per phase key, every weapon the loadout can use there, fastest first */
  options: Record<string, WeaponOption[]>;
  /** Per phase key, spec weapons by the spec's damage per second, best first */
  specs: Record<string, SpecRank[]>;
  /** Per phase key, every searched weapon, fastest first; missing on results saved before it existed */
  tiers?: Record<string, WeaponTier[]>;
}

/** A weapon the searches found for a phase, at its best setup there */
export interface WeaponTier {
  weaponId: number;
  style: BestStyle;
  /** Thralls included */
  dps: number;
  seconds: number;
  /** The weapon's price, 0 when owned */
  cost: number;
  /** The loadout holds the weapon */
  held: boolean;
  attack?: string;
}

/** Per phase, every searched weapon at its best setup, fastest first: the tier list behind a phase's weapons */
export const weaponTiers = (
  candidates: Candidate[],
  hpByKey: Map<string, number>,
  extraDps: number,
  priceOf: (id: number) => number,
  itemIds: number[],
): Record<string, WeaponTier[]> => {
  const held = new Set(itemIds.map(getCanonicalItemId));
  const best = new Map<string, Map<number, Candidate>>();
  candidates.forEach((c) => {
    const weaponId = c.setup.player.equipment.weapon?.id;
    if (weaponId === undefined || !hpByKey.has(c.phaseKey)) return;
    const byWeapon = best.get(c.phaseKey) ?? new Map<number, Candidate>();
    if (!byWeapon.has(weaponId) || byWeapon.get(weaponId)!.dps < c.dps) byWeapon.set(weaponId, c);
    best.set(c.phaseKey, byWeapon);
  });
  return Object.fromEntries([...best.entries()].map(([key, byWeapon]) => [key, [...byWeapon.entries()].map(([weaponId, c]) => {
    const dps = c.dps + extraDps;
    return {
      weaponId, style: c.style, dps, seconds: hpByKey.get(key)! / dps, cost: priceOf(weaponId), held: held.has(getCanonicalItemId(weaponId)), attack: attackLabel(c.setup.player),
    };
  }).sort((a, b) => b.dps - a.dps)]));
};

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
    const option = {
      weaponId, dps, seconds: hpByKey.get(c.phaseKey)! / dps, attack: attackLabel(c.setup.player),
    };
    options[c.phaseKey] = existing ? list.map((o) => (o === existing ? option : o)) : [...list, option];
  });
  Object.values(options).forEach((list) => list.sort((a, b) => b.dps - a.dps));
  return options;
};

const SPELLBOOKS: Record<MagicOption, Spellbook[]> = {
  thralls: [], none: [], ancients: ['ancient'], standard: ['standard'],
};

/** The best setup search's inputs for the raid: the account, the chosen styles, the spellbook the magic option allows */
export const raidBaseInputs = (settings: RaidSettings): BestInputs => ({
  ...settings.account,
  styles: BEST_STYLES.filter((st) => settings.styles.includes(st)),
  topN: 1,
  spellbooks: SPELLBOOKS[settings.magic],
});

/** Why the run can't start: a route boss that forbids the magic option, while rules are on */
export const blockReason = (settings: RaidSettings): string | null => {
  if (!settings.rulesOn) return null;
  const boss = routeBosses(raidById(settings.raidId), settings.route)
    .find((b) => b.rules?.forbiddenMagic?.options.includes(settings.magic));
  return boss?.rules?.forbiddenMagic?.reason ?? null;
};

// the most of the budget the Defence weapons may take together (a 89m Elder maul has no place in a 100m loadout); the
// plan also keeps them within what the setup and the spec weapon leave
export const DEFENCE_BUDGET_SHARE = 0.3;

/**
 * Each phase's Defence specs as the loadout can do them. With prices, the Elder maul, then the Tonalztics of Ralos, then
 * the Dragon warhammer come only while they fit in `allowance` (DEFENCE_BUDGET_SHARE of the budget by default); the
 * specs of a maul or Tonalztics that doesn't fit become Dragon warhammer specs, and those go too when it doesn't fit.
 * An excluded weapon's specs stay, free: a teammate does them.
 */
export const plannedCounts = (
  settings: RaidSettings,
  priceOf?: (id: number) => number,
  allowance: number = settings.budget * DEFENCE_BUDGET_SHARE,
): Record<string, DefenceCounts> => {
  const raid = raidById(settings.raidId);
  const own = routePhases(raid, settings.route, settings.counts).filter((p) => !p.phase.defenceFrom);
  const counts = Object.fromEntries(own.map((p) => [p.phase.key, { ...p.counts }]));
  if (!priceOf) return counts;
  const excluded = new Set(excludedOf(settings));
  const teammate = (w: DefenceWeapon) => excluded.has(getCanonicalItemId(DEFENCE_WEAPON_IDS[w]));
  const used = (w: DefenceWeapon) => own.some((p) => counts[p.phase.key][w] > 0);
  let spent = 0;
  const fits = (w: DefenceWeapon) => {
    if (teammate(w)) return true;
    const price = priceOf(getCanonicalItemId(DEFENCE_WEAPON_IDS[w]));
    if (spent + price > allowance) return false;
    spent += price;
    return true;
  };
  const dropped = (['elderMaul', 'tonalztic'] as DefenceWeapon[]).filter((w) => used(w) && !fits(w));
  const dwh = (used('dwh') || dropped.length > 0) && fits('dwh');
  Object.values(counts).forEach((c) => {
    dropped.forEach((w) => {
      // eslint-disable-next-line no-param-reassign
      c.dwh += c[w];
      // eslint-disable-next-line no-param-reassign
      c[w] = 0;
    });
    // eslint-disable-next-line no-param-reassign
    if (!dwh) c.dwh = 0;
  });
  return counts;
};

/** Each phase's Defence specs a teammate does: those of excluded weapons only */
export const teammateCounts = (settings: RaidSettings): Record<string, DefenceCounts> => {
  const excluded = new Set(excludedOf(settings));
  const counts = plannedCounts(settings);
  Object.values(counts).forEach((c) => DEFENCE_WEAPONS.forEach((w) => {
    // eslint-disable-next-line no-param-reassign
    if (!excluded.has(getCanonicalItemId(DEFENCE_WEAPON_IDS[w]))) c[w] = 0;
  }));
  return counts;
};

/** The items the loadout must hold whatever the budget: the always-bring items, boss requirements (with rules on), the book for thralls */
export const baseRequiredItems = (settings: RaidSettings): number[] => {
  const raid = raidById(settings.raidId);
  const excluded = new Set(excludedOf(settings));
  const ids = [
    ...settings.bringIds,
    ...(settings.rulesOn ? routeBosses(raid, settings.route).flatMap((b) => b.rules?.requiredItemIds ?? []) : []),
    ...(settings.magic === 'thralls' ? [BOOK_OF_THE_DEAD] : []),
  ].map(getCanonicalItemId);
  return [...new Set(ids)].filter((id) => !excluded.has(id));
};

/** The Defence weapons the loadout holds for these specs: those used and not excluded */
const defenceWeaponsFor = (settings: RaidSettings, counts: Record<string, DefenceCounts>): number[] => {
  const excluded = new Set(excludedOf(settings));
  return DEFENCE_WEAPONS.filter((w) => Object.values(counts).some((c) => c[w] > 0))
    .map((w) => getCanonicalItemId(DEFENCE_WEAPON_IDS[w])).filter((id) => !excluded.has(id));
};

/** Items the loadout must hold: the base ones and the Defence weapons in use (as plannedCounts has them, with prices) */
export const requiredItems = (settings: RaidSettings, priceOf?: (id: number) => number): number[] => [...new Set([
  ...baseRequiredItems(settings), ...defenceWeaponsFor(settings, plannedCounts(settings, priceOf)),
])];

let pool: EquipmentPiece[] | null = null;
const prepare = (settings: RaidSettings, prices: Prices | null) => {
  if (!pool) pool = bestPool();
  const raid = raidById(settings.raidId);
  const owned = new Set(settings.ownedIds.map(getCanonicalItemId));
  const priceOf = (id: number) => itemPrice(id, prices, owned);
  // the specs the budget allows: the searches fight the monsters with the Defence those leave
  const phases = routePhases(raid, settings.route, plannedCounts(settings, priceOf));
  const excluded = excludedOf(settings);
  const tiers = tierExclusions(settings.budget, priceOf, excluded, pool, requiredItems(settings, priceOf));
  return {
    phases, priceOf, tiers, base: raidBaseInputs(settings), pool,
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
    phases, priceOf, tiers, base, pool: items,
  } = prepare(settings, prices);
  const candidates = await raidCandidates(phases, base, tiers, deps, onProgress, cache, search);
  const extraDps = settings.magic === 'thralls' ? THRALL_DPS : 0;
  const excluded = new Set(excludedOf(settings));
  const specs = await specRanking(phases, candidates, [...excluded], deps, cache);
  const players = new Map<BestStyle, Player>();
  const playerFor = (style: BestStyle) => {
    if (!players.has(style)) players.set(style, basePlayer(base, style));
    return players.get(style)!;
  };
  const rate = dpsRater(deps, cache);
  // what has to be dealt: each phase, or each part of one, by the styles that can
  const units = phases.flatMap((p) => (p.phase.parts ?? [{ share: 1 }]).map((part): KitUnit => {
    const allowed = p.phase.allowedStyles;
    const styles = part.styles && allowed ? part.styles.filter((st) => allowed.includes(st)) : (part.styles ?? allowed);
    return { key: p.phase.key, hp: p.monster.monster.skills.hp * part.share, styles };
  }));
  const raid = raidById(settings.raidId);
  const monstersByCounts = new Map<string, Map<string, BulkMonster>>();
  const monstersFor = (counts: Record<string, DefenceCounts>) => {
    const key = JSON.stringify(counts);
    if (!monstersByCounts.has(key)) {
      monstersByCounts.set(key, new Map(routePhases(raid, settings.route, counts).map((p) => [p.phase.key, p.monster])));
    }
    return monstersByCounts.get(key)!;
  };
  const baseRequired = baseRequiredItems(settings);
  const costOf = (ids: number[]) => ids.reduce((n, id) => n + priceOf(id), 0);
  const kitPool = items.filter((e) => !excluded.has(getCanonicalItemId(e.id)));
  /**
   * In order of what matters most, never over the budget: (1) a viable setup for every room, kits and weapons from at
   * most CORE_SHARE of the budget, against the bosses' full Defence (only a teammate's specs); (2) the best spec weapon
   * the rest pays for; (3) Defence drain the rest after that pays for, the Dragon warhammer before nothing; (4) upgrades
   * with whatever is left, rated with the drain. A bad setup with a great spec or drain weapon is no plan.
   */
  const assemble = async (maxItems: number) => {
    const core = await planKits({
      units,
      monsters: monstersFor(teammateCounts(settings)),
      candidates,
      priceOf,
      budget: settings.budget * CORE_SHARE,
      maxItems,
      requiredIds: baseRequired,
      extraDps,
      playerFor,
      pool: kitPool,
    }, rate);
    let left = settings.budget - core.cost;
    // each from the money left, and at most its share of the budget: a 361m Zaryte crossbow or 89m Elder maul has no
    // place in a small loadout however cheap its setup
    const spec = routeSpec(specs, (r) => specPrice(r, priceOf) <= Math.min(left, settings.budget * SPEC_BUDGET_SHARE));
    const specIds = spec ? [spec.weaponId, ...(spec.ammoId !== null ? [spec.ammoId] : [])].map(getCanonicalItemId) : [];
    left -= costOf(specIds.filter((id) => !core.itemIds.includes(id)));
    const counts = plannedCounts(settings, priceOf, Math.max(0, Math.min(left, settings.budget * DEFENCE_BUDGET_SHARE)));
    const monsters = monstersFor(counts);
    const requiredIds = [...new Set([...baseRequired, ...specIds, ...defenceWeaponsFor(settings, counts)])];
    // the setup's DPS with the drain
    const picks = await Promise.all(core.picks.map(async (pick) => {
      if (!pick.candidate) return pick;
      const [dps] = await rate([pick.candidate.setup], monsters.get(pick.key)!);
      return { ...pick, candidate: { ...pick.candidate, dps }, seconds: pick.hp / Math.max(dps + extraDps, NO_SETUP_DPS) };
    }));
    const itemIds = orderedItems(picks, requiredIds);
    const plan = await upgradeLoadout({
      plan: {
        ...core,
        picks,
        itemIds,
        cost: costOf(itemIds),
        totalSeconds: picks.reduce((n, pick) => n + pick.seconds, 0),
        main: mainSetup(picks),
      },
      monsters,
      candidates,
      pool: items,
      priceOf,
      budget: settings.budget,
      maxItems,
      requiredIds,
      excluded,
      extraDps,
      playerFor,
    }, rate);
    return { plan, counts };
  };
  // the main setup worn is the one leaving the fewest switches (Masori, the Zaryte crossbow and the book beside it
  // rather than a melee set with everything ranged in the bag), the longest-used of equally good ones
  const lay = (plan: RaidPlan) => {
    const mains = [plan.main, ...plan.picks.map((p) => p.candidate)].filter((c): c is Candidate => !!c);
    const distinct = mains.filter((c, i) => mains.findIndex((o) => o.setup.id === c.setup.id) === i);
    return slotEfficientLayout(plan.itemIds, distinct.map((c) => c.setup), settings.supplies, settings.magic);
  };
  const freeCells = (l: Layout) => l.inventory.filter((c) => c === null).length;
  // the item limit assumes all worn slots are filled; when the main setup wears fewer, switches overflow, so plan again
  // with fewer items
  let maxItems = WORN_SLOTS + freeSwitchSlots(settings.supplies, settings.magic);
  let { plan, counts } = await assemble(maxItems);
  let layout = lay(plan);
  for (let i = 0; i < MAX_REPLANS && layout.overflow > 0 && maxItems > 0; i++) {
    maxItems = Math.max(0, Math.min(maxItems, plan.itemIds.length) - layout.overflow);
    // eslint-disable-next-line no-await-in-loop
    ({ plan, counts } = await assemble(maxItems));
    layout = lay(plan);
  }
  // the item limit counts every worn slot once; a quiver's slot or a lighter main setup can leave inventory cells free,
  // so plan again with them while that is faster and still fits
  for (let i = 0; i < MAX_REPLANS && layout.overflow === 0 && freeCells(layout) > 0; i++) {
    const more = Math.max(maxItems, plan.itemIds.length) + freeCells(layout);
    // eslint-disable-next-line no-await-in-loop
    const next = await assemble(more);
    const nextLayout = lay(next.plan);
    if (nextLayout.overflow > 0 || next.plan.totalSeconds >= plan.totalSeconds - 1e-6) break;
    maxItems = more;
    ({ plan, counts } = next);
    layout = nextLayout;
  }
  // the upgraded setups count as candidates for the weapon cells
  const all = [...candidates, ...plan.picks.flatMap((p) => (p.candidate ? [p.candidate] : []))];
  const hpByKey = new Map(phases.map((p) => [p.phase.key, p.monster.monster.skills.hp]));
  return {
    build: BUILD_ID,
    plan,
    layout,
    phases: phases.map((p) => ({
      key: p.phase.key,
      label: p.phase.label,
      bossId: p.boss.id,
      bossName: p.boss.name,
      hp: p.monster.monster.skills.hp,
      // the specs the plan does: its Defence weapons' and a teammate's
      counts: counts[p.phase.defenceFrom ?? p.phase.key] ?? p.counts,
      parts: p.phase.parts,
      allowedStyles: p.phase.allowedStyles,
    })),
    options: weaponOptions(all, plan.itemIds, hpByKey, extraDps),
    specs,
    tiers: weaponTiers(all, hpByKey, extraDps, priceOf, plan.itemIds),
  };
};
