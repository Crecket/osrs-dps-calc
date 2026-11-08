/**
 * The raid gear pipeline: route phases, price tiers, candidate searches (cached), assembly and layout. Main thread
 * only (basePlayer imports '@/state').
 */
import { getCanonicalItemId } from '@/lib/Equipment';
import { BUILD_ID } from '@/lib/build';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { BestRunDeps, runBestSetup } from '@/best/lib/run';
import { bestPool, withoutOutclassed } from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import {
  AccountInputs, BestInputs, BEST_STYLES, BestStyle,
} from '@/best/types';
import { defaultAccount } from '@/best/lib/account';
import { EquipmentPiece, Player } from '@/types/Player';
import { Spellbook } from '@/types/Spell';
import {
  DEFENCE_WEAPON_IDS, DefenceCounts, MagicOption, PhasePart, Route, RoutePhase,
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
import { orderedItems, RaidPlan, THRALL_DPS } from '@/raid/lib/assemble';
import { KitUnit, planKits } from '@/raid/lib/kits';
import { dpsRater, upgradeLoadout } from '@/raid/lib/upgrade';
import { itemReplacements, Replacement, WorthContext } from '@/raid/lib/itemValue';
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
  /** The settings the run planned with; missing on results saved before it existed */
  settings?: RaidSettings;
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
    // a held weapon shows as the loadout uses it: only setups of items it holds, not the weapon's best searched gear
    if (held.has(getCanonicalItemId(weaponId)) && !c.itemIds.every((id) => held.has(id))) return;
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

// the most of the budget the player's Defence weapons may take together (a 89m Elder maul has no place in a 100m
// loadout); the plan also keeps them within what the setup and the spec weapon leave
export const DEFENCE_BUDGET_SHARE = 0.3;

/**
 * The Defence weapons the player brings to do their part of the team's configured Defence specs, never an excluded one:
 * for Elder maul specs the maul, else (when it doesn't fit, not when excluded: a teammate has it then) the Dragon
 * warhammer, the same job, weaker and far cheaper; for Dragon warhammer specs the warhammer;
 * for Tonalztics specs the Tonalztics of Ralos, which nothing stands in for. With prices, each only while it fits in
 * `allowance` (DEFENCE_BUDGET_SHARE of the budget by default), the maul's slot first. The configured specs themselves
 * stay as they are: the team does them, whatever this player carries.
 */
export const drainWeapons = (
  settings: RaidSettings,
  priceOf?: (id: number) => number,
  allowance: number = settings.budget * DEFENCE_BUDGET_SHARE,
): number[] => {
  const raid = raidById(settings.raidId);
  const excluded = new Set(excludedOf(settings));
  const phases = routePhases(raid, settings.route, settings.counts);
  const configured = (w: keyof typeof DEFENCE_WEAPON_IDS) => phases.some((p) => p.counts[w] > 0);
  const [maul, dwh, ralos] = [DEFENCE_WEAPON_IDS.elderMaul, DEFENCE_WEAPON_IDS.dwh, DEFENCE_WEAPON_IDS.tonalztic].map(getCanonicalItemId);
  let spent = 0;
  const brings = (id: number) => {
    if (excluded.has(id)) return false;
    if (!priceOf) return true;
    if (spent + priceOf(id) > allowance) return false;
    spent += priceOf(id);
    return true;
  };
  const out: number[] = [];
  if (configured('elderMaul')) {
    // a maul excluded or too dear for the budget becomes the player's warhammer: a team wants a drain from everyone
    if (!excluded.has(maul) && brings(maul)) out.push(maul);
    else if (brings(dwh)) out.push(dwh);
  } else if (configured('dwh') && brings(dwh)) out.push(dwh);
  if (configured('tonalztic') && brings(ralos)) out.push(ralos);
  return out;
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

/** Items the loadout must hold: the base ones and the player's Defence weapons (as drainWeapons has them) */
export const requiredItems = (settings: RaidSettings, priceOf?: (id: number) => number): number[] => [...new Set([
  ...baseRequiredItems(settings), ...drainWeapons(settings, priceOf),
])];

let pool: EquipmentPiece[] | null = null;
const prepare = (settings: RaidSettings, prices: Prices | null) => {
  if (!pool) pool = bestPool();
  const raid = raidById(settings.raidId);
  const owned = new Set(settings.ownedIds.map(getCanonicalItemId));
  const priceOf = (id: number) => itemPrice(id, prices, owned);
  // the configured specs: the team lowers the Defence whatever this player carries
  const phases = routePhases(raid, settings.route, settings.counts);
  const excluded = excludedOf(settings);
  const tiers = tierExclusions(settings.budget, priceOf, excluded, pool, requiredItems(settings, priceOf));
  return {
    phases, priceOf, tiers, base: raidBaseInputs(settings), pool,
  };
};

/** What has to be dealt: each phase, or each part of one, by the styles that can. The plan's picks follow this order */
const raidUnits = (phases: RoutePhase[]): KitUnit[] => phases.flatMap((p) => (p.phase.parts ?? [{ share: 1 }]).map((part): KitUnit => {
  const allowed = p.phase.allowedStyles;
  const styles = part.styles && allowed ? part.styles.filter((st) => allowed.includes(st)) : (part.styles ?? allowed);
  return { key: p.phase.key, hp: p.monster.monster.skills.hp * part.share, styles };
}));

/**
 * The replacements for an item of a result's loadout, rated as the run that made it would: with the result's settings,
 * the current prices. Null for a weapon or an item no setup wears.
 */
export const replacementsFor = async (
  result: RaidResult,
  fallback: RaidSettings,
  id: number,
  prices: Prices | null,
  deps: BestRunDeps,
  cache: SearchCache,
): Promise<Replacement[] | null> => {
  const settings = result.settings ?? fallback;
  const { phases, priceOf, pool: items } = prepare(settings, prices);
  const left = new Set(excludedOf(settings).map(getCanonicalItemId));
  const base = raidBaseInputs(settings);
  const ctx: WorthContext = {
    picks: result.plan.picks,
    styles: raidUnits(phases).map((u) => u.styles),
    monsters: new Map(phases.map((p) => [p.phase.key, p.monster])),
    extraDps: settings.magic === 'thralls' ? THRALL_DPS : 0,
    rate: dpsRater(deps, cache),
    playerFor: (style) => basePlayer(base, style),
  };
  return itemReplacements(ctx, id, withoutOutclassed(items.filter((e) => !left.has(getCanonicalItemId(e.id)))), priceOf, result.plan.itemIds);
};

/** Searches a run would still have to do; 0 means it only re-plans from the cache */
export const searchesNeeded = (settings: RaidSettings, prices: Prices | null, cache: SearchCache): number => {
  const { phases, base, tiers } = prepare(settings, prices);
  return missingSearches(phases, base, tiers, cache);
};

/**
 * Finds the raid loadout: runs the searches that aren't cached, then assembles and lays out the loadout.
 * @param signal once aborted the run rejects with Error('cancelled'), also while it plans from cached numbers alone
 */
export const runRaid = async (
  settings: RaidSettings,
  prices: Prices | null,
  deps: BestRunDeps,
  onProgress: (p: RaidProgress) => void,
  cache: SearchCache,
  search: typeof runBestSetup = runBestSetup,
  signal?: AbortSignal,
): Promise<RaidResult> => {
  const {
    phases, priceOf, tiers, base, pool: items,
  } = prepare(settings, prices);
  // the searches' last progress, kept for the planning steps after them
  let last: RaidProgress = {
    search: 0, searches: 0, phaseLabel: '', inner: null, cached: 0,
  };
  const candidates = await raidCandidates(phases, base, tiers, deps, (p) => {
    last = p;
    onProgress(p);
  }, cache, search);
  const planning = (label: string, done = 0, total = 0) => onProgress({ ...last, inner: null, planning: { label, done, total } });
  planning('Ranking spec weapons');
  const extraDps = settings.magic === 'thralls' ? THRALL_DPS : 0;
  const excluded = new Set(excludedOf(settings));
  const specs = await specRanking(phases, candidates, [...excluded], deps, cache);
  const players = new Map<BestStyle, Player>();
  const playerFor = (style: BestStyle) => {
    if (!players.has(style)) players.set(style, basePlayer(base, style));
    return players.get(style)!;
  };
  const rate = dpsRater(deps, cache, signal);
  // what has to be dealt: each phase, or each part of one, by the styles that can
  const units = raidUnits(phases);
  // the bosses as the team leaves them: the configured specs, whatever this player carries
  const monsters = new Map(phases.map((p) => [p.phase.key, p.monster]));
  const baseRequired = baseRequiredItems(settings);
  const costOf = (ids: number[]) => ids.reduce((n, id) => n + priceOf(id), 0);
  const kitPool = withoutOutclassed(items.filter((e) => !excluded.has(getCanonicalItemId(e.id))));
  /**
   * In order of what matters most, never over the budget: (1) a viable setup for every room, kits and weapons from at
   * most CORE_SHARE of the budget; (2) the player's part of the team's Defence specs, a drain weapon the rest pays for, the
   * Dragon warhammer before nothing (it saves the most, and a team wants one from everyone); (3) the best spec weapon the
   * rest after that pays for; (4) upgrades with whatever
   * is left. A bad setup with a great spec or drain weapon is no plan. The bosses' Defence is the configured specs'
   * throughout: the team does them, whatever this player carries.
   */
  let attempt = 0;
  const assemble = async (maxItems: number) => {
    attempt += 1;
    const tryLabel = `Planning the loadout${attempt > 1 ? ` (fitting the bag, try ${attempt})` : ''}`;
    planning(`${tryLabel} · picking a setup per room`);
    const core = await planKits({
      units,
      monsters,
      candidates,
      priceOf,
      budget: settings.budget * CORE_SHARE,
      maxItems,
      requiredIds: baseRequired,
      extraDps,
      playerFor,
      pool: kitPool,
      signal,
    }, rate);
    let left = settings.budget - core.cost;
    // each from the money left, and at most its share of the budget: a 361m Zaryte crossbow or 89m Elder maul has no
    // place in a small loadout however cheap its setup. The Defence drain first: it saves the team the most, and a
    // team wants one from everyone rather than a damage spec alone
    const drain = drainWeapons(settings, priceOf, Math.max(0, Math.min(left, settings.budget * DEFENCE_BUDGET_SHARE)));
    left -= costOf(drain.filter((id) => !core.itemIds.includes(id)));
    const spec = routeSpec(specs, (r) => specPrice(r, priceOf) <= Math.min(left, settings.budget * SPEC_BUDGET_SHARE));
    const specIds = spec ? [spec.weaponId, ...(spec.ammoId !== null ? [spec.ammoId] : [])].map(getCanonicalItemId) : [];
    const requiredIds = [...new Set([...baseRequired, ...specIds, ...drain])];
    const itemIds = orderedItems(core.picks, requiredIds);
    return upgradeLoadout({
      plan: { ...core, itemIds, cost: costOf(itemIds) },
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
      onStep: (label, done, total) => planning(`${tryLabel} · ${label}`, done, total),
    }, rate);
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
  let plan = await assemble(maxItems);
  let layout = lay(plan);
  for (let i = 0; i < MAX_REPLANS && layout.overflow > 0 && maxItems > 0; i++) {
    maxItems = Math.max(0, Math.min(maxItems, plan.itemIds.length) - layout.overflow);
    // eslint-disable-next-line no-await-in-loop
    plan = await assemble(maxItems);
    layout = lay(plan);
  }
  // the item limit counts every worn slot once; a quiver's slot or a lighter main setup can leave inventory cells free,
  // so plan again with them while that is faster and still fits
  for (let i = 0; i < MAX_REPLANS && layout.overflow === 0 && freeCells(layout) > 0; i++) {
    const more = Math.max(maxItems, plan.itemIds.length) + freeCells(layout);
    // eslint-disable-next-line no-await-in-loop
    const next = await assemble(more);
    const nextLayout = lay(next);
    if (nextLayout.overflow > 0 || next.totalSeconds >= plan.totalSeconds - 1e-6) break;
    maxItems = more;
    plan = next;
    layout = nextLayout;
  }
  // the upgraded setups count as candidates for the weapon cells, and each held setup is rated on every phase its style
  // can deal, so a held weapon shows on every phase with its real DPS in the loadout's gear
  planning('Rating the held weapons on every phase');
  const heldSetups = plan.picks.flatMap((p) => (p.candidate ? [p.candidate] : []))
    .filter((c, i, list) => list.findIndex((o) => o.setup.id === c.setup.id) === i);
  const canDeal = (p: typeof phases[number], style: BestStyle) => (!p.phase.allowedStyles || p.phase.allowedStyles.includes(style))
    && (!p.phase.parts || p.phase.parts.some((part) => !part.styles || part.styles.includes(style)));
  const everywhere = (await Promise.all(phases.map(async (p) => {
    const list = heldSetups.filter((c) => canDeal(p, c.style));
    const dps = await rate(list.map((c) => c.setup), monsters.get(p.phase.key)!);
    return list.map((c, i) => ({ ...c, phaseKey: p.phase.key, dps: dps[i] }));
  }))).flat();
  const all = [...candidates, ...heldSetups, ...everywhere];
  const hpByKey = new Map(phases.map((p) => [p.phase.key, p.monster.monster.skills.hp]));
  return {
    build: BUILD_ID,
    settings,
    plan,
    layout,
    phases: phases.map((p) => ({
      key: p.phase.key,
      label: p.phase.label,
      bossId: p.boss.id,
      bossName: p.boss.name,
      hp: p.monster.monster.skills.hp,
      counts: p.counts,
      parts: p.phase.parts,
      allowedStyles: p.phase.allowedStyles,
    })),
    options: weaponOptions(all, plan.itemIds, hpByKey, extraDps),
    specs,
    tiers: weaponTiers(all, hpByKey, extraDps, priceOf, plan.itemIds),
  };
};
