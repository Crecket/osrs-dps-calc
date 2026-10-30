/**
 * The raid gear pipeline: route phases, price tiers, candidate searches (cached), assembly and layout. Main thread
 * only (basePlayer imports '@/state').
 */
import { getCanonicalItemId } from '@/lib/Equipment';
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
  DEFENCE_WEAPON_IDS, DEFENCE_WEAPONS, DefenceCounts, MagicOption, PhasePart, Route,
} from '@/raid/types';
import { raidById } from '@/raid/raids';
import { routeBosses, routePhases } from '@/raid/lib/route';
import { itemPrice, Prices } from '@/raid/lib/prices';
import {
  Candidate, missingSearches, raidCandidates, RaidProgress, tierExclusions,
} from '@/raid/lib/candidates';
import { SearchCache } from '@/raid/lib/searchCache';
import { routeSpec, SpecRank, specRanking } from '@/raid/lib/specs';
import { RaidPlan, THRALL_DPS } from '@/raid/lib/assemble';
import { KitUnit, planKits } from '@/raid/lib/kits';
import { dpsRater, upgradeLoadout } from '@/raid/lib/upgrade';
import {
  freeSwitchSlots, Layout, slotEfficientLayout, Supplies,
} from '@/raid/lib/layout';

export const BOOK_OF_THE_DEAD = 25818;
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

/** Items the loadout must hold: the always-bring items, boss requirements (with rules on), defence weapons in use, the book for thralls */
export const requiredItems = (settings: RaidSettings): number[] => {
  const raid = raidById(settings.raidId);
  const excluded = new Set(excludedOf(settings));
  const phases = routePhases(raid, settings.route, settings.counts, settings.excludedIds);
  const ids = [
    ...settings.bringIds,
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
  const excluded = excludedOf(settings);
  const tiers = tierExclusions(settings.budget, priceOf, excluded, pool, requiredItems(settings));
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
  // the route's best spec weapon and its spec ammo come along
  const spec = routeSpec(specs);
  const requiredIds = [...new Set([
    ...requiredItems(settings),
    ...(spec ? [spec.weaponId, ...(spec.ammoId !== null ? [spec.ammoId] : [])].map(getCanonicalItemId) : []),
  ])];
  const players = new Map<BestStyle, Player>();
  const playerFor = (style: BestStyle) => {
    if (!players.has(style)) players.set(style, basePlayer(base, style));
    return players.get(style)!;
  };
  const rate = dpsRater(deps, cache);
  // a kit per style and its weapons first, then better items slot by slot with the budget and slots left
  // what has to be dealt: each phase, or each part of one, by the styles that can
  const units = phases.flatMap((p) => (p.phase.parts ?? [{ share: 1 }]).map((part): KitUnit => {
    const allowed = p.phase.allowedStyles;
    const styles = part.styles && allowed ? part.styles.filter((st) => allowed.includes(st)) : (part.styles ?? allowed);
    return { key: p.phase.key, hp: p.monster.monster.skills.hp * part.share, styles };
  }));
  const monsters = new Map(phases.map((p) => [p.phase.key, p.monster]));
  const assemble = async (maxItems: number) => upgradeLoadout({
    plan: await planKits({
      units,
      monsters,
      candidates,
      priceOf,
      budget: settings.budget,
      maxItems,
      requiredIds,
      extraDps,
      playerFor,
      pool: items.filter((e) => !excluded.has(getCanonicalItemId(e.id))),
    }, rate),
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
  // the upgraded setups count as candidates for the weapon cells
  const all = [...candidates, ...plan.picks.flatMap((p) => (p.candidate ? [p.candidate] : []))];
  const hpByKey = new Map(phases.map((p) => [p.phase.key, p.monster.monster.skills.hp]));
  return {
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
    })),
    options: weaponOptions(all, plan.itemIds, hpByKey, extraDps),
    specs,
    tiers: weaponTiers(all, hpByKey, extraDps, priceOf, plan.itemIds),
  };
};
