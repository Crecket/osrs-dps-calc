/**
 * The per-weapon search of the best setup finder. This file runs inside the best setup web workers, so it must not
 * import '@/state', React, or anything under src/app.
 */
import PlayerVsNPCCalc from '@/lib/PlayerVsNPCCalc';
import { availableEquipment } from '@/lib/Equipment';
import { scaleMonster } from '@/lib/MonsterScaling';
import { Monster } from '@/types/Monster';
import { EquipmentPiece, Player, PlayerEquipment } from '@/types/Player';
import { spells } from '@/types/Spell';
import { preparePlayer } from '@/bulk/lib/compute';
import {
  GearSlot, paretoFront, slotCandidates, styleScore, WeaponJob,
} from '@/best/lib/candidates';
import { SETS, WEAPON_LINKED } from '@/best/lib/effectItems';
import { BestStyle } from '@/best/types';

/** Item ids per slot; null = empty. The weapon (and ammo or dart, when the job fixes it) comes from the job. */
export type Gear = Partial<Record<GearSlot, number | null>>;

export interface SearchResult {
  job: WeaponJob;
  gear: Gear;
  dps: number;
  /** True when the result comes from coordinate descent, which may miss the best setup */
  approximate: boolean;
}

/** A set from SETS with its pieces resolved to items of the pool. */
export interface ResolvedSet {
  name: string;
  pieces: Partial<Record<GearSlot, EquipmentPiece>>;
}

type SlotLists = Partial<Record<GearSlot, EquipmentPiece[]>>;

const GEAR_SLOTS: GearSlot[] = ['head', 'cape', 'neck', 'ammo', 'body', 'shield', 'legs', 'hands', 'feet', 'ring'];
const TWIN_OFFSET = -1000000;
// DPS differences below this are float noise
const EPSILON = 1e-9;

let itemsById: Map<number, EquipmentPiece> | null = null;
const twins = new Map<number, EquipmentPiece>();

/** An item with the same stats and an id and name the engine doesn't recognise, so none of its effects apply. */
export const plainTwin = (item: EquipmentPiece): EquipmentPiece => ({
  ...item,
  id: TWIN_OFFSET - item.id,
  name: `__plain ${item.id}`,
});

const itemById = (id: number): EquipmentPiece => {
  if (id <= TWIN_OFFSET) {
    let twin = twins.get(id);
    if (!twin) {
      twin = plainTwin(itemById(TWIN_OFFSET - id));
      twins.set(id, twin);
    }
    return twin;
  }
  if (!itemsById) itemsById = new Map(availableEquipment.map((e) => [e.id, e]));
  const item = itemsById.get(id);
  if (!item) throw new Error(`Unknown item id ${id}`);
  return item;
};

/** Dresses `base` in the job's weapon, stance, spell, ammo or dart, and `gear`. Two-handed weapons empty the shield. */
export const buildPlayer = (base: Player, job: WeaponJob, gear: Gear): Player => {
  let weapon = itemById(job.weaponId);
  if (job.dartId !== null) {
    weapon = { ...weapon, itemVars: { blowpipeDartId: job.dartId, blowpipeDartName: itemById(job.dartId).name } };
  }
  const equipment = { weapon } as PlayerEquipment;
  GEAR_SLOTS.forEach((slot) => {
    const id = gear[slot];
    equipment[slot] = id === undefined || id === null ? null : itemById(id);
  });
  if (job.ammoId !== null) equipment.ammo = itemById(job.ammoId);
  if (weapon.isTwoHanded) equipment.shield = null;
  return {
    ...base,
    equipment,
    style: job.combatStyle,
    spell: job.spellName === null ? null : spells.find((s) => s.name === job.spellName) ?? null,
  };
};

// scaling depends on the monster only, so it is done once per monster instead of once per evaluation. The cache is keyed
// by object identity: callers must pass a new monster object when its inputs change, never mutate one in place.
const scaledMonsters = new WeakMap<Monster, Monster>();
const scaled = (monster: Monster): Monster => {
  let result = scaledMonsters.get(monster);
  if (!result) {
    // computeRow skips scaling for custom monsters (id -1)
    result = monster.id === -1 ? monster : scaleMonster(monster);
    scaledMonsters.set(monster, result);
  }
  return result;
};

/** DPS of the dressed player, as computeRow calculates it; 0 when the engine throws. */
export const evalDps = (base: Player, monster: Monster, job: WeaponJob, gear: Gear): number => {
  try {
    const player = preparePlayer(buildPlayer(base, job, gear), monster);
    const dps = new PlayerVsNPCCalc(player, scaled(monster), { disableMonsterScaling: true }).getDps();
    return Number.isFinite(dps) ? dps : 0;
  } catch {
    return 0;
  }
};

/** Memoises `make` per (pool array, style); pools are compared by identity. */
const perPoolStyle = <T>(make: (pool: EquipmentPiece[], style: BestStyle) => T) => {
  const cache = new WeakMap<EquipmentPiece[], Map<BestStyle, T>>();
  return (pool: EquipmentPiece[], style: BestStyle): T => {
    let byStyle = cache.get(pool);
    if (!byStyle) {
      byStyle = new Map();
      cache.set(pool, byStyle);
    }
    if (!byStyle.has(style)) byStyle.set(style, make(pool, style));
    return byStyle.get(style)!;
  };
};

// slotCandidates is slow (canonical lookups), and the same for every job of a style
const candidatesFor = perPoolStyle((pool, style) => Object.fromEntries(GEAR_SLOTS
  .map((slot) => [slot, slotCandidates(pool, style, slot)])) as Record<GearSlot, ReturnType<typeof slotCandidates>>);

/** Pool items with `name`, lowest id first. */
const poolByName = perPoolStyle((pool) => {
  const byName = new Map<string, EquipmentPiece[]>();
  [...pool].sort((a, b) => a.id - b.id).forEach((e) => byName.set(e.name, [...(byName.get(e.name) ?? []), e]));
  return byName;
});

/** Every effect item of the pool per slot, before the activity test. */
export const effectCandidates = (pool: EquipmentPiece[], style: BestStyle): SlotLists => {
  const candidates = candidatesFor(pool, style);
  return Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, candidates[slot].effect]));
};

/** The slots the search fills for a job: no shield with a two-handed weapon, no ammo when the job fixes it. */
const searchSlots = (job: WeaponJob): GearSlot[] => {
  const twoHanded = itemById(job.weaponId).isTwoHanded;
  return GEAR_SLOTS.filter((slot) => !(slot === 'shield' && twoHanded) && !(slot === 'ammo' && job.ammoId !== null));
};

/** Ranged jobs without fixed ammo (bowfa, blowpipes, thrown weapons): ammo bonuses don't count, so only ammo effects can matter. */
const firesNoAmmo = (job: WeaponJob) => job.style === 'ranged' && job.ammoId === null;

/** The plain candidates the job can use in `slot`: none in the ammo slot of a job that fires no ammo. */
const usablePlain = (job: WeaponJob, slot: GearSlot, items: EquipmentPiece[]) => (slot === 'ammo' && firesNoAmmo(job) ? [] : items);

const sumScore = (item: EquipmentPiece, style: BestStyle) => styleScore(item, style).reduce((a, b) => a + b);

/** The item with the highest attack + strength; ties keep the first. */
const strongestOf = (items: EquipmentPiece[], style: BestStyle): EquipmentPiece | undefined => items
  .reduce<EquipmentPiece | undefined>((best, e) => (!best || sumScore(e, style) > sumScore(best, style) ? e : best), undefined);

const baselineFrom = (job: WeaponJob, plain: SlotLists): Gear => Object.fromEntries(searchSlots(job)
  .map((slot) => [slot, strongestOf(usablePlain(job, slot, plain[slot] ?? []), job.style)?.id ?? null]));

/** Per slot the plain candidate with the highest attack + strength for the job's style; the shield stays empty for two-handers. */
export const baselineGear = (pool: EquipmentPiece[], job: WeaponJob): Gear => {
  const candidates = candidatesFor(pool, job.style);
  return baselineFrom(job, Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, candidates[slot].plain])));
};

/**
 * True when an item's effect changes DPS: `real` with the item, `twin` with its plain twin. An effect that lowers DPS
 * matters too: as a plain item its bonuses could prune items that beat it in real DPS.
 */
export const effectMatters = (real: number, twin: number): boolean => Math.abs(real - twin) > EPSILON;

/**
 * The activity test: an effect item stays an effect candidate only when its effect changes DPS in `baseline`; the
 * others do nothing here beyond their bonuses.
 */
export const activeEffects = (base: Player, monster: Monster, job: WeaponJob, baseline: Gear, effect: SlotLists): SlotLists => {
  const slots = searchSlots(job);
  return Object.fromEntries(slots.map((slot) => [slot, (effect[slot] ?? []).filter((item) => effectMatters(
    evalDps(base, monster, job, { ...baseline, [slot]: item.id }),
    evalDps(base, monster, job, { ...baseline, [slot]: plainTwin(item).id }),
  ))]));
};

/** Pool items of the WEAPON_LINKED entries that match the job's weapon, spell or ammo, per slot. */
export const linkedEffects = (pool: EquipmentPiece[], job: WeaponJob): SlotLists => {
  const weapon = itemById(job.weaponId).name;
  const byName = poolByName(pool, job.style);
  const items = WEAPON_LINKED
    .filter((l) => l.weapons?.test(weapon) || (job.spellName !== null && l.spells?.test(job.spellName)) || (l.ammo && job.ammoId !== null))
    .flatMap((l) => l.items.flatMap((name) => byName.get(name) ?? []));
  const lists: SlotLists = {};
  items.forEach((e) => {
    if (e.slot !== 'weapon') lists[e.slot] = [...(lists[e.slot] ?? []), e];
  });
  return lists;
};

/**
 * The activity test for one job against its own baseline, to share as the effect candidates of a whole style. It only
 * sees what that job can see: effects tied to another weapon, spell or ammo (WEAPON_LINKED), and slots the job doesn't
 * fill (a two-hander's shield), test as inactive. searchWeapon re-tests WEAPON_LINKED items per job; shield effects
 * need a one-handed reference job.
 */
export const styleEffects = (base: Player, monster: Monster, job: WeaponJob, pool: EquipmentPiece[]): SlotLists => activeEffects(
  base,
  monster,
  job,
  baselineGear(pool, job),
  effectCandidates(pool, job.style),
);

/**
 * The job to run the shared activity test on: the one with the highest baseline DPS, the first of equal ones. Null when none deals damage, since effects test as inactive on a job that can't hurt the monster.
 */
export const referenceJob = (base: Player, monster: Monster, jobs: WeaponJob[], pool: EquipmentPiece[]): WeaponJob | null => {
  let best: WeaponJob | null = null;
  let bestDps = 0;
  jobs.forEach((job) => {
    const dps = evalDps(base, monster, job, baselineGear(pool, job));
    if (dps > bestDps + EPSILON) {
      best = job;
      bestDps = dps;
    }
  });
  return best;
};

/** Each SETS entry with its pieces taken from the pool (the strongest version of each name); sets missing a piece are left out. */
const resolveSets = perPoolStyle((pool, style): ResolvedSet[] => SETS.flatMap((set) => {
  const pieces: Partial<Record<GearSlot, EquipmentPiece>> = {};
  const complete = (Object.entries(set.pieces) as [GearSlot, string][]).every(([slot, name]) => {
    const piece = strongestOf((poolByName(pool, style).get(name) ?? []).filter((e) => e.slot === slot), style);
    if (piece) pieces[slot] = piece;
    return piece !== undefined;
  });
  return complete ? [{ name: set.name, pieces }] : [];
}));

/** Sets whose pieces, worn together in `baseline`, beat the same pieces as plain twins. */
export const activeSets = (base: Player, monster: Monster, job: WeaponJob, baseline: Gear, pool: EquipmentPiece[]): ResolvedSet[] => {
  const slots = new Set(searchSlots(job));
  return resolveSets(pool, job.style).filter((set) => {
    const entries = Object.entries(set.pieces) as [GearSlot, EquipmentPiece][];
    if (entries.some(([slot]) => !slots.has(slot))) return false;
    const real = evalDps(base, monster, job, { ...baseline, ...Object.fromEntries(entries.map(([slot, p]) => [slot, p.id])) });
    const twin = evalDps(base, monster, job, { ...baseline, ...Object.fromEntries(entries.map(([slot, p]) => [slot, plainTwin(p).id])) });
    return real > twin + EPSILON;
  });
};

/** The best `size` results with distinct DPS, best first; of equal DPS the first one found stays. */
class TopResults {
  readonly results: SearchResult[] = [];

  constructor(private readonly size: number) {}

  add(result: SearchResult) {
    if (this.size <= 0) return;
    if (this.results.some((r) => Math.abs(r.dps - result.dps) <= EPSILON)) return;
    const worst = this.results[this.results.length - 1];
    if (this.results.length >= this.size && result.dps <= worst.dps) return;
    const at = this.results.findIndex((r) => r.dps < result.dps);
    this.results.splice(at === -1 ? this.results.length : at, 0, result);
    if (this.results.length > this.size) this.results.pop();
  }
}

/**
 * The best setups for one weapon job. Effect items that do nothing here (activity test, or `opts.effects` plus a
 * per-job test of the WEAPON_LINKED items when given) become plain items and are dominance-pruned; active sets are always tested for the job and enter as units.
 * Exhaustive mode enumerates every combination of candidates when there are at most `opts.cap`, else it falls back to
 * coordinate descent and marks the results approximate. Results are the top `opts.topN` with distinct DPS, best first.
 */
export const searchWeapon = (
  base: Player,
  monster: Monster,
  job: WeaponJob,
  pool: EquipmentPiece[],
  opts: { mode: 'descent' | 'exhaustive'; topN: number; cap: number; effects?: SlotLists },
): SearchResult[] => {
  const { style } = job;
  const slots = searchSlots(job);
  const candidates = candidatesFor(pool, style);
  const baseline = baselineGear(pool, job);
  let active = opts.effects ?? activeEffects(base, monster, job, baseline, effectCandidates(pool, style));
  if (opts.effects) {
    // the shared effects come from another job: re-test what depends on this job's weapon, spell or ammo
    const linked = activeEffects(base, monster, job, baseline, linkedEffects(pool, job));
    active = Object.fromEntries(GEAR_SLOTS.map((slot) => [slot, [
      ...(active[slot] ?? []),
      ...(linked[slot] ?? []).filter((e) => !active[slot]?.some((a) => a.id === e.id)),
    ]]));
  }
  const sets = activeSets(base, monster, job, baseline, pool);

  const plain: SlotLists = {};
  const options: Partial<Record<GearSlot, (number | null)[]>> = {};
  slots.forEach((slot) => {
    const activeIds = new Set((active[slot] ?? []).map((e) => e.id));
    // empty is a (0, 0) plain item that wins ties: it beats items with nothing positive, and loses to items with nothing negative
    plain[slot] = paretoFront(usablePlain(job, slot, [...candidates[slot].plain, ...candidates[slot].effect.filter((e) => !activeIds.has(e.id))]), style)
      .filter((e) => styleScore(e, style).some((v) => v > 0));
    const emptyDominated = plain[slot]!.some((e) => styleScore(e, style).every((v) => v >= 0));
    const ids = [
      ...plain[slot]!.map((e) => e.id),
      ...(active[slot] ?? []).map((e) => e.id),
      ...sets.flatMap((s) => (s.pieces[slot] ? [s.pieces[slot]!.id] : [])),
    ];
    options[slot] = [...new Set<number | null>([...ids, ...(emptyDominated ? [] : [null])])];
  });

  // slots the search doesn't fill still show in the results
  const fixed: Gear = Object.fromEntries(GEAR_SLOTS.filter((slot) => !slots.includes(slot))
    .map((slot) => [slot, slot === 'ammo' ? job.ammoId : null]));
  const top = new TopResults(opts.topN);
  const memo = new Map<string, number>();
  const evaluate = (gear: Gear, approximate: boolean): number => {
    const key = slots.map((slot) => gear[slot] ?? '').join(',');
    let dps = memo.get(key);
    if (dps === undefined) {
      dps = evalDps(base, monster, job, gear);
      memo.set(key, dps);
      top.add({
        job, gear: { ...fixed, ...gear }, dps, approximate,
      });
    }
    return dps;
  };

  const combinations = slots.reduce((n, slot) => n * options[slot]!.length, 1);
  if (opts.mode === 'exhaustive' && combinations <= opts.cap) {
    const counters = slots.map(() => 0);
    for (let n = 0; n < combinations; n++) {
      evaluate(Object.fromEntries(slots.map((slot, i) => [slot, options[slot]![counters[i]]])), false);
      // odometer step
      for (let i = 0; i < counters.length; i++) {
        counters[i] += 1;
        if (counters[i] < options[slots[i]]!.length) break;
        counters[i] = 0;
      }
    }
    return top.results;
  }

  // coordinate descent from the strongest plain setup: per slot (and per active set) take the best move, until a full pass improves nothing
  let current = baselineFrom(job, plain);
  let currentDps = evaluate(current, true);
  const moves: Gear[][] = [
    ...slots.map((slot) => options[slot]!.map((id) => ({ [slot]: id }))),
    ...sets.map((set) => [Object.fromEntries(Object.entries(set.pieces).map(([slot, p]) => [slot, p.id]))]),
  ];
  let improved = true;
  while (improved) {
    improved = false;
    for (const group of moves) {
      const from = current;
      for (const move of group) {
        const gear = { ...from, ...move };
        const dps = evaluate(gear, true);
        if (dps > currentDps + EPSILON) {
          current = gear;
          currentDps = dps;
          improved = true;
        }
      }
    }
  }
  return top.results;
};
