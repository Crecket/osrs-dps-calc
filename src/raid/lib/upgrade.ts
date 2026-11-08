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
import { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { getCombatStylesForCategory } from '@/utils';
import { BestRunDeps } from '@/best/lib/run';
import {
  crystalOk, GearSlot, isCrystalArmour, isCrystalWeapon, scoreKind, styleScore, withoutOutclassed,
} from '@/best/lib/candidates';
import { SETS } from '@/best/lib/effectItems';
import { hashKey } from '@/best/lib/resultCache';
import { BestStyle } from '@/best/types';
import {
  BulkMonster, BulkSetup, GEAR_SLOT_ORDER,
} from '@/bulk/types';
import { Candidate, fromStored, toStored } from '@/raid/lib/candidates';
import { SearchCache, StoredCandidate } from '@/raid/lib/searchCache';
import {
  mainSetup, minGainFor, orderedItems, PhasePick, RaidPlan, wearsLightbearer, yieldToBrowser,
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
  /** Each pass as it starts, for the page's progress */
  onStep?: (label: string, done: number, total: number) => void;
}

/** The passes in the order they run, for progress */
const STEPS = ['Upgrading gear', 'Leaving armour sets', 'Trying other weapons', 'Camping switches', 'Swapping for cheaper items', 'Selling back expensive items', 'Building kits', 'Filling free cells'] as const;

// besides the searched items, the items with the best bonuses for the style tried per slot
const TOP_PER_SLOT = 6;
// price levels at which each slot's strongest item is tried too
const PRICE_BANDS = [100_000, 1_000_000, 10_000_000, 100_000_000];
// as in the assembly's cost-aware pass: free upgrades first, but tiny gains don't win on price alone
const COST_SMOOTHING = 100_000;
const MAX_STEPS = 60;
// the most expensive armour pieces tried back for a cheaper one, the money freed going to the rest (a weapon upgrade
// rather than 142m Avernic treads), kept only when the raid gets this much faster
const MAX_SELL_BACK = 4;
const SELL_BACK_SECONDS = 1;
// times the step leaves a set and climbs again
const MAX_SET_ROUNDS = 4;
// weapons given to single units, and the other weapons tried per unit
const MAX_WEAPON_ADDS = 4;
// armour switches swapped for pieces another setup wears
const MAX_CAMPS = 12;
// items swapped for cheaper ones doing the same damage, the cheaper items rated per slot, and the seconds over the raid
// such a swap may lose (rounding)
const MAX_CHEAPEN = 16;
const CHEAPER_TRIES = 8;
const CHEAPEN_LOSS = 0.05;
// what money is worth in raid time, both ways: a purchase must save at least this per gp it adds, and a swap for
// something cheaper may lose this per gp it saves. One rate, or a swap undone by the next purchase (an Armadyl crossbow
// 0.1s faster than the Dragon crossbow for 40m, given back and bought again)
const SECONDS_PER_GP = 1 / 100e6;
/** The seconds spending `extra` gp must save */
const moneyBar = (extra: number) => Math.max(0, extra) * SECONDS_PER_GP;
const WEAPONS_PER_UNIT = 5;
const MIN_GAIN = 1e-6;
// what an armour switch (an item only one setup wears) must save over the raid for its bag cell: most players camp the
// main setup's piece rather than bring a slightly better one, boots most of all. Low enough that a melee set over the
// ranged armour (an Inquisitor's piece saves ~17s over a raid's melee phases) still pays.
const SWITCH_SECONDS = 15;
const BOOT_SWITCH_SECONDS = 30;
// what a switch must save per bag cell once the planning is done and cells and money are left over: an empty cell is
// worth nothing, so a melee piece over the ranged armour (a Bandos chestplate saves ~6s) goes in rather than nothing
const FILL_SECONDS = 3;
// a switch this cheap is one everybody brings (the Infernal cape, Fighter torso, Ava's assembler, a defender): it takes a
// cell at the fill bar from the start and the climb, rating time per gp, puts it before anything bought
const FREE_PRICE = 1_000_000;
// changes built up into one setup's kit before it is judged as a whole
const MAX_KIT = 8;
const switchSeconds = (slot: GearSlot | 'stance'): number => {
  if (slot === 'feet') return BOOT_SWITCH_SECONDS;
  if (slot === 'stance' || slot === 'ammo') return 0;
  return SWITCH_SECONDS;
};
/** What a change in `slot` growing the loadout from `from` items to `to` must save: an armour switch its cell's worth */
const switchGain = (slot: GearSlot | 'stance', from: number, to: number) => Math.max(
  minGainFor(from, to),
  MIN_GAIN + switchSeconds(slot) * Math.max(0, to - from),
);
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
  /** The slot changed, or 'stance' for another way of attacking with the same weapon */
  slot: GearSlot | 'stance';
  from: number | null;
  to: number;
  /** The change, applied to a setup of the group */
  apply: (s: StoredCandidate) => StoredCandidate;
  /** Per unit of the group, its setup with the item in the slot and that setup's DPS */
  next: Candidate[];
}

/** The item's name without its trailing variant marks: "Avernic treads (pr)(pe)" -> "Avernic treads" */
const familyOf = (e: EquipmentPiece) => e.name.replace(/(\s*\([^)]*\))+$/, '');
/** At least as good as `b` in every offence and bonus */
const covers = (a: EquipmentPiece, b: EquipmentPiece) => (Object.keys(b.offensive) as (keyof EquipmentPiece['offensive'])[])
  .every((k) => a.offensive[k] >= b.offensive[k])
  && (Object.keys(b.bonuses) as (keyof EquipmentPiece['bonuses'])[]).every((k) => a.bonuses[k] >= b.bonuses[k]);

const setKey = (ids: number[]) => [...new Set(ids)].sort((a, b) => a - b).join(',');
const isBlowpipe = (w: EquipmentPiece) => w.itemVars?.blowpipeDartId !== undefined || /blowpipe/i.test(w.name);

export const upgradeLoadout = async (input: UpgradeInput, rate: RateFn): Promise<RaidPlan> => {
  const {
    plan, monsters, priceOf, budget, maxItems, excluded, extraDps,
  } = input;
  const required = new Set(input.requiredIds);
  const searched = new Set(input.candidates.flatMap((c) => c.itemIds));
  const bySlot = new Map<string, EquipmentPiece[]>();
  withoutOutclassed(input.pool.filter((e) => !excluded.has(getCanonicalItemId(e.id)))).forEach((e) => {
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

  /** How much an item's bonuses help the setup's weapon and style */
  const valueFor = (c: Candidate) => {
    const kind = scoreKind(c.setup.player.equipment.weapon!, c.style);
    return (e: EquipmentPiece) => {
      const [attack, strength] = styleScore(e, kind);
      return attack + 2 * strength;
    };
  };

  /** The items worth trying in each slot of the group's setup */
  const tries = (c: Candidate): { slot: GearSlot; item: EquipmentPiece }[] => {
    const weapon = c.setup.player.equipment.weapon!;
    const value = valueFor(c);
    return SLOTS.flatMap((slot) => {
      if ((slot === 'shield' && weapon.isTwoHanded) || (slot === 'ammo' && isBlowpipe(weapon))
        || (slot === 'ring' && wearsLightbearer(c.style))) return [];
      const current = c.setup.player.equipment[slot];
      // crystal armour only with a crystal bow
      let items = (bySlot.get(slot) ?? []).filter((e) => e.id !== current?.id && (isCrystalWeapon(weapon) || !isCrystalArmour(e)));
      if (slot === 'ammo') items = items.filter((e) => ammoApplicability(weapon.id, e.id) === AmmoApplicability.INCLUDED);
      const top = items.filter((e) => !searched.has(e.id) && (!current || value(e) > value(current)))
        .sort((a, b) => value(b) - value(a))
        .slice(0, TOP_PER_SLOT);
      // and the best cheaper ones: a downgrade that pays for a bigger gain elsewhere
      const cheaper = current ? items.filter((e) => !searched.has(e.id) && !top.includes(e) && priceOf(e.id) < priceOf(current.id))
        .sort((a, b) => value(b) - value(a))
        .slice(0, TOP_PER_SLOT) : [];
      // and the strongest at a few price levels, so cheap useful gear (an Amulet of strength over free filler) is tried
      // even when the strongest items are out of reach
      const banded = PRICE_BANDS.map((band) => items.filter((e) => !searched.has(e.id) && !top.includes(e) && !cheaper.includes(e)
        && priceOf(e.id) <= band && (!current || value(e) > value(current)))
        .sort((a, b) => value(b) - value(a) || priceOf(a.id) - priceOf(b.id))[0])
        .filter((e, i, all): e is EquipmentPiece => !!e && all.indexOf(e) === i);
      return [...items.filter((e) => searched.has(e.id)), ...top, ...cheaper, ...banded].map((item) => ({ slot, item }));
    });
  };

  let variant = 0;
  /** The group's setups with the change applied, unrated; null when one can't be built */
  const build = (group: Group, apply: Move['apply']): Candidate[] | null => {
    const first = variant;
    variant += group.units.length;
    const next = group.units.map((u, i) => {
      const stored = apply(toStored(u.candidate.setup, u.candidate.style, 0));
      const built = fromStored(stored, u.pick.key, input.playerFor(stored.style));
      return built ? { ...built, setup: { ...built.setup, id: `upgrade-${first + i + 1}` } } : null;
    });
    return next.some((n) => n === null) ? null : next as Candidate[];
  };

  /**
   * The weapon's other stances of its style group (Aggressive slash, or crush, for a Soulreaper axe searched on
   * Accurate): the search picked the stance for its own gear, and after an upgrade another can be faster
   */
  const stances = (c: Candidate): { style: BestStyle; combatStyle: PlayerCombatStyle }[] => {
    const weapon = c.setup.player.equipment.weapon!;
    const melee = (t: BestStyle) => t === 'stab' || t === 'slash' || t === 'crush';
    const current = c.setup.player.style;
    return getCombatStylesForCategory(weapon.category)
      .filter((st) => st.type && (st.type === c.style || (melee(c.style) && melee(st.type as BestStyle))))
      .filter((st) => st.name !== current.name || st.type !== current.type)
      .map((st) => ({ style: st.type as BestStyle, combatStyle: st }));
  };

  const movesFor = async (group: Group): Promise<Move[]> => {
    const c = group.units[0].candidate;
    const weaponId = getCanonicalItemId(c.setup.player.equipment.weapon!.id);
    const gearMoves = tries(c).flatMap(({ slot, item }): Move[] => {
      const apply = (st: StoredCandidate) => ({ ...st, gear: { ...st.gear, [slot]: item.id } });
      const next = build(group, apply);
      if (!next) return [];
      const from = c.setup.player.equipment[slot];
      return [{
        slot, from: from ? getCanonicalItemId(from.id) : null, to: getCanonicalItemId(item.id), apply, next,
      }];
    });
    const stanceMoves = stances(c).flatMap(({ style, combatStyle }): Move[] => {
      const apply = (st: StoredCandidate) => ({ ...st, style, job: { ...st.job, style, combatStyle } });
      const next = build(group, apply);
      return next ? [{
        slot: 'stance', from: weaponId, to: weaponId, apply, next,
      }] : [];
    });
    const moves = [...gearMoves, ...stanceMoves];
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

  // the last climb fills the cells left over at a lower bar
  let filling = false;
  const fillGain = (from: number, to: number) => MIN_GAIN + FILL_SECONDS * Math.max(0, to - from);
  const isFree = (id: number) => priceOf(id) <= FREE_PRICE;
  const needed = (move: Move, from: number, to: number) => (filling || isFree(move.to)
    ? fillGain(from, to) : switchGain(move.slot, from, to));

  /** Single changes while one fits, then pairs of them */
  const climb = async () => {
    for (let step = 0; step < MAX_STEPS; step++) {
      // eslint-disable-next-line no-await-in-loop
      await yieldToBrowser();
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
          if (!(gain > needed(move, current.size, next.size) + moneyBar(nextCost - cost))) continue;
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
      // eslint-disable-next-line no-await-in-loop
      await yieldToBrowser();
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
          if (costOf(next) > cap || next.size > Math.max(maxItems, current.size) || gain <= Math.max(needed(a.move, current.size, next.size), needed(b.move, current.size, next.size)) + moneyBar(costOf(next) - costOf(current))) continue;
          best = { a, b, gain };
          break;
        }
      }
      if (!best) break;
      const { a, b } = best as { a: typeof all[number]; b: typeof all[number] };
      rejected.add(keyOf(a, b));
      if (a.group === b.group) {
        const { group } = a;
        const next = build(group, (st) => b.move.apply(a.move.apply(st)));
        if (!next) continue;
        // eslint-disable-next-line no-await-in-loop
        const dps = await Promise.all(group.units.map((u, i) => rate([next[i].setup], u.monster).then(([d]) => d)));
        const rated = next.map((n, i) => ({ ...n, dps: dps[i] }));
        const size = loadout({ group, items: swapped(swapped(group.items, a.move), b.move) }).size;
        const pairCost = costOf(loadout({ group, items: swapped(swapped(group.items, a.move), b.move) })) - costOf(current);
        if (!(gainOf(group, rated) > (filling || (isFree(a.move.to) && isFree(b.move.to)) ? fillGain(current.size, size) : minGainFor(current.size, size)) + moneyBar(pairCost))) continue;
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
  };

  /**
   * Out of a whole armour set at once (Void, Blood Moon): one piece at a time never pays, as the first swap loses the
   * set effect. Every setup wearing the set gets other items in its slots, at a few price levels, when that saves time.
   */
  const leaveSet = async (): Promise<boolean> => {
    const current = loadout();
    const cost = costOf(current);
    const cap = Math.max(budget, cost);
    let best: { wearing: Group[]; rated: Candidate[][]; score: number } | null = null;
    for (const set of SETS) {
      const slots = Object.keys(set.pieces) as GearSlot[];
      const names = new Set(Object.values(set.pieces));
      const wearing = groups.filter((g) => slots.every((slot) => {
        const e = g.units[0].candidate.setup.player.equipment[slot];
        return !!e && familyOf(e) === set.pieces[slot as keyof typeof set.pieces];
      }));
      if (!wearing.length) continue;
      const value = valueFor(wearing[0].units[0].candidate);
      const crystal = isCrystalWeapon(wearing[0].units[0].candidate.setup.player.equipment.weapon);
      const options = slots.map((slot) => (bySlot.get(slot) ?? []).filter((e) => !names.has(familyOf(e)) && (crystal || !isCrystalArmour(e)))
        .sort((a, b) => value(b) - value(a) || priceOf(a.id) - priceOf(b.id)));
      if (options.some((o) => !o.length)) continue;
      // the best at a few ranks, and the best that fits the budget slot by slot
      let spare = cap - cost + slots.reduce((n, slot) => n + priceOf(wearing[0].units[0].candidate.setup.player.equipment[slot]!.id), 0);
      const affordable = options.map((o) => {
        const e = o.find((x) => priceOf(x.id) <= spare) ?? o[o.length - 1];
        spare -= priceOf(e.id);
        return e;
      });
      const variants = [0, 1, 2].map((rank) => options.map((o) => o[Math.min(rank, o.length - 1)])).concat([affordable])
        .filter((v, k, all) => all.findIndex((w) => w.every((e, n) => e.id === v[n].id)) === k);
      for (const v of variants) {
        const apply = (st: StoredCandidate) => ({ ...st, gear: { ...st.gear, ...Object.fromEntries(slots.map((slot, n) => [slot, v[n].id])) } });
        const built = wearing.map((g) => build(g, apply));
        if (built.some((b) => b === null)) continue;
        // eslint-disable-next-line no-await-in-loop
        const rated = await Promise.all(wearing.map((g, k) => Promise.all(g.units.map((u, n) => rate([built[k]![n].setup], u.monster)
          .then(([d]) => ({ ...built[k]![n], dps: d }))))));
        const next = loadout(...wearing.map((g, k) => ({ group: g, items: [...rated[k][0].itemIds] })));
        const nextCost = costOf(next);
        if (nextCost > cap || next.size > Math.max(maxItems, current.size)) continue;
        const gain = wearing.reduce((n, g, k) => n + gainOf(g, rated[k]), 0);
        if (!(gain > minGainFor(current.size, next.size) + moneyBar(nextCost - costOf(current)))) continue;
        const score = gain / (Math.max(0, nextCost - cost) + COST_SMOOTHING);
        if (!best || score > best.score) best = { wearing, rated, score };
      }
    }
    if (!best) return false;
    for (const [k, group] of best.wearing.entries()) {
      group.units.forEach((u, n) => {
        // eslint-disable-next-line no-param-reassign
        u.candidate = best!.rated[k][n];
      });
      group.items = [...best.rated[k][0].itemIds];
      // eslint-disable-next-line no-await-in-loop
      group.moves = await movesFor(group);
    }
    return true;
  };

  /**
   * Another weapon for one unit, in the armour it wears (a blowpipe switch for the phases it beats the crossbow on):
   * the steps above only change armour slots, and the kit planner fixed the weapons before the armour was bought. The
   * unit leaves its group for one of its own. On its own when it fits, else together with one armour change elsewhere
   * that frees the money or the bag cell (melee wearing the ranged boots instead of its own pair).
   */
  const otherWeapons = new Map<Unit, { from: Candidate; options: Candidate[] }>();
  /** Candidate `c`'s weapon (its ammo and stance) in the armour `u` wears; null when it can't be built */
  const inGearOf = (u: Unit, c: Candidate): Candidate | null => {
    const mine = toStored(u.candidate.setup, u.candidate.style, 0);
    const theirs = toStored(c.setup, c.style, 0);
    const weapon = c.setup.player.equipment.weapon!;
    const gear = {
      ...mine.gear,
      ammo: theirs.gear.ammo ?? null,
      shield: weapon.isTwoHanded ? null : (mine.gear.shield ?? theirs.gear.shield ?? null),
    };
    const next = fromStored({ ...theirs, gear }, u.pick.key, input.playerFor(theirs.style));
    if (!next || !crystalOk(next.setup.player.equipment)) return null;
    variant += 1;
    return { ...next, setup: { ...next.setup, id: `upgrade-${variant}` } };
  };
  const weaponOptions = async (u: Unit): Promise<Candidate[]> => {
    // built from the unit's gear: stale once that changed (another pass gave its boots back)
    const known = otherWeapons.get(u);
    if (known?.from === u.candidate) return known.options;
    const own = u.candidate.setup.player.equipment.weapon!;
    const group = (st: BestStyle) => (st === 'ranged' || st === 'magic' ? st : 'melee');
    // the phase's best setup of each other weapon of the unit's style group
    const best = new Map<number, Candidate>();
    input.candidates.filter((c) => c.phaseKey === u.pick.key && group(c.style) === group(u.candidate.style)
      && c.setup.player.equipment.weapon!.id !== own.id && !excluded.has(getCanonicalItemId(c.setup.player.equipment.weapon!.id)))
      .forEach((c) => {
        const id = c.setup.player.equipment.weapon!.id;
        if (!best.has(id) || best.get(id)!.dps < c.dps) best.set(id, c);
      });
    const picked = [...best.values()].sort((a, b) => b.dps - a.dps).slice(0, WEAPONS_PER_UNIT);
    const built = picked.flatMap((c) => {
      const next = inGearOf(u, c);
      return next ? [next] : [];
    });
    const dps = await rate(built.map((c) => c.setup), u.monster);
    const rated = built.map((c, i) => ({ ...c, dps: dps[i] }))
      .filter((c) => seconds(u.pick.hp, c.dps) < seconds(u.pick.hp, u.candidate.dps) - MIN_GAIN);
    otherWeapons.set(u, { from: u.candidate, options: rated });
    return rated;
  };

  const addWeapons = async (): Promise<boolean> => {
    const current = loadout();
    const cost = costOf(current);
    const cap = Math.max(budget, cost);
    const limit = Math.max(maxItems, current.size);
    let best: { unit: Unit; next: Candidate; partner: { group: Group; move: Move } | null; gain: number } | null = null;
    for (const group of groups) {
      for (const unit of group.units) {
        // eslint-disable-next-line no-await-in-loop
        const options = await weaponOptions(unit);
        // the loadout with the unit in its new setup and its group's other units as they are
        const others = group.units.filter((x) => x !== unit);
        for (const next of options) {
          const gain = seconds(unit.pick.hp, unit.candidate.dps) - seconds(unit.pick.hp, next.dps);
          const items = (partner: { group: Group; move: Move } | null) => {
            const groupItems = others.length ? [...new Set(others.flatMap((x) => x.candidate.itemIds))] : [];
            const swaps = [{ group, items: groupItems }];
            if (partner) {
              const base = partner.group === group ? groupItems : partner.group.items;
              swaps.push({ group: partner.group, items: base.includes(partner.move.from ?? -1) || partner.move.from === null ? swapped(base, partner.move) : base });
            }
            return new Set([...loadout(...swaps.filter((sw, i) => swaps.findIndex((o) => o.group === sw.group) === i)), ...next.itemIds]);
          };
          const alone = items(null);
          if (costOf(alone) <= cap && alone.size <= limit && gain > minGainFor(current.size, alone.size) + moneyBar(costOf(alone) - cost)) {
            if (!best || gain > best.gain) {
              best = {
                unit, next, partner: null, gain,
              };
            }
            continue;
          }
          for (const pg of groups) {
            // the partner change applies to the units left in the group
            const idx = pg.units.map((x, i) => (x === unit ? -1 : i)).filter((i) => i >= 0);
            if (!idx.length) continue;
            for (const move of pg.moves) {
              const partnerGain = idx.reduce((n, i) => n + seconds(pg.units[i].pick.hp, pg.units[i].candidate.dps)
                - seconds(pg.units[i].pick.hp, move.next[i].dps), 0);
              if (!Number.isFinite(partnerGain)) continue;
              const total = gain + partnerGain;
              if (best && total <= best.gain) continue;
              const both = items({ group: pg, move });
              if (costOf(both) > cap || both.size > limit || !(total > minGainFor(current.size, both.size) + moneyBar(costOf(both) - cost))) continue;
              best = {
                unit, next, partner: { group: pg, move }, gain: total,
              };
            }
          }
        }
      }
    }
    if (!best) return false;
    const { unit, next, partner } = best;
    const home = groups.find((g) => g.units.includes(unit))!;
    if (partner) {
      partner.group.units.forEach((x, i) => {
        if (x === unit) return;
        // eslint-disable-next-line no-param-reassign
        x.candidate = partner.move.next[i];
      });
    }
    home.units = home.units.filter((x) => x !== unit);
    unit.candidate = next;
    groups.push({ units: [unit], items: [...next.itemIds], moves: [] });
    // groups left empty go; the others take their items from their units again
    for (let i = groups.length - 1; i >= 0; i--) {
      if (!groups[i].units.length) groups.splice(i, 1);
    }
    for (const g of groups) {
      g.items = [...new Set(g.units.flatMap((x) => x.candidate.itemIds))];
      // eslint-disable-next-line no-await-in-loop
      g.moves = await movesFor(g);
    }
    otherWeapons.clear();
    return true;
  };

  const startStep = async (label: typeof STEPS[number]) => {
    input.onStep?.(label, STEPS.indexOf(label), STEPS.length);
    await yieldToBrowser();
  };
  await startStep('Upgrading gear');
  await climb();
  await startStep('Leaving armour sets');
  // eslint-disable-next-line no-await-in-loop
  for (let round = 0; round < MAX_SET_ROUNDS && await leaveSet(); round++) await climb();
  await startStep('Trying other weapons');
  // eslint-disable-next-line no-await-in-loop
  for (let round = 0; round < MAX_WEAPON_ADDS && await addWeapons(); round++) await climb();

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

  /**
   * Armour switches that don't earn their cell go: a piece only one setup wears is swapped for the piece another setup
   * wears in that slot when that costs at most its switch's worth of seconds (the kits come whole, every piece a switch).
   * The cheapest loss first, one at a time.
   */
  /**
   * Groups that came to wear the same items become one again (a unit the weapon step split off, climbed into the
   * items of another): the camp and the cheapening below see a piece two such groups wear as shared, and leave it.
   */
  const regroup = async () => {
    const merged = new Set<Group>();
    for (let i = 0; i < groups.length; i++) {
      for (let j = groups.length - 1; j > i; j--) {
        if (setKey(groups[j].items) !== setKey(groups[i].items)) continue;
        groups[i].units.push(...groups[j].units);
        groups.splice(j, 1);
        merged.add(groups[i]);
      }
    }
    for (const group of merged) {
      // eslint-disable-next-line no-await-in-loop
      group.moves = await movesFor(group);
    }
  };
  await regroup();

  const campSwitches = async (): Promise<boolean> => {
    let best: { group: Group; rated: Candidate[]; loss: number } | null = null;
    for (const group of groups) {
      const equipment = group.units[0].candidate.setup.player.equipment;
      for (const slot of SLOTS) {
        const mine = equipment[slot];
        if (slot === 'ammo' || !mine) continue;
        const id = getCanonicalItemId(mine.id);
        if (required.has(id) || groups.some((g) => g !== group && g.items.includes(id))) continue;
        const elsewhere = groups.filter((g) => g !== group).map((g) => g.units[0].candidate.setup.player.equipment[slot])
          .filter((e): e is EquipmentPiece => !!e)
          .filter((e, i, list) => list.findIndex((o) => o.id === e.id) === i);
        for (const other of elsewhere) {
          const next = build(group, (st) => ({ ...st, gear: { ...st.gear, [slot]: other.id } }));
          if (!next || !next.every((n) => crystalOk(n.setup.player.equipment))) continue;
          // eslint-disable-next-line no-await-in-loop
          const rated = await Promise.all(group.units.map((u, i) => rate([next[i].setup], u.monster).then(([d]) => ({ ...next[i], dps: d }))));
          const loss = -gainOf(group, rated);
          if (loss <= (isFree(id) ? FILL_SECONDS : switchSeconds(slot)) && (!best || loss < best.loss)) best = { group, rated, loss };
        }
      }
    }
    if (!best) return false;
    const { group, rated } = best;
    group.units.forEach((u, i) => {
      // eslint-disable-next-line no-param-reassign
      u.candidate = rated[i];
    });
    group.items = [...new Set(rated.flatMap((c) => c.itemIds))];
    group.moves = await movesFor(group);
    return true;
  };
  // after the variant merge, which keeps one item that covers both without a loss; the money a camped switch frees goes
  // to the climb again, with every group's moves as its setups now are
  let camped = 0;
  await startStep('Camping switches');
  // eslint-disable-next-line no-await-in-loop
  while (camped < MAX_CAMPS && await campSwitches()) camped += 1;
  // a camped switch can leave two groups in the same items
  await regroup();

  /**
   * Items that cost more than one doing the same damage go: the climb only takes changes that save time, so Oathplate
   * bought for its strength on a crush setup (its accuracy is slash) stays where Bandos and a faceguard do the same.
   * A piece only one setup wears is swapped for the cheaper pool item, at least as strong for the style by bonuses, that
   * loses no time; the most money first, one at a time.
   */
  const allowedLoss = (saving: number) => CHEAPEN_LOSS + saving * SECONDS_PER_GP;
  const cheapen = async (): Promise<boolean> => {
    const current = loadout();
    const cost = costOf(current);
    let best: { group: Group; rated: Candidate[]; saving: number } | null = null;
    for (const group of groups) {
      const c = group.units[0].candidate;
      const { equipment } = c.setup.player;
      const value = valueFor(c);
      const weapon = equipment.weapon!;
      for (const slot of SLOTS) {
        const mine = equipment[slot];
        if (slot === 'ammo' || !mine) continue;
        const id = getCanonicalItemId(mine.id);
        if (required.has(id) || groups.some((g) => g !== group && g.items.includes(id))) continue;
        const options = (bySlot.get(slot) ?? []).filter((e) => e.id !== mine.id && value(e) >= value(mine)
          && (isCrystalWeapon(weapon) || !isCrystalArmour(e)))
          .map((e) => ({ e, items: [...group.items.filter((x) => x !== id), getCanonicalItemId(e.id)] }))
          .map((o) => ({ ...o, saving: cost - costOf(loadout({ group, items: o.items })) }))
          .filter((o) => o.saving > 0 && loadout({ group, items: o.items }).size <= Math.max(maxItems, current.size))
          .sort((a, b) => b.saving - a.saving)
          .slice(0, CHEAPER_TRIES);
        for (const o of options) {
          if (best && o.saving <= best.saving) break;
          const next = build(group, (st) => ({ ...st, gear: { ...st.gear, [slot]: o.e.id } }));
          if (!next || !next.every((n) => crystalOk(n.setup.player.equipment))) continue;
          // eslint-disable-next-line no-await-in-loop
          const rated = await Promise.all(group.units.map((u, i) => rate([next[i].setup], u.monster).then(([d]) => ({ ...next[i], dps: d }))));
          if (-gainOf(group, rated) > allowedLoss(o.saving)) continue;
          best = { group, rated, saving: o.saving };
          break;
        }
      }
      // a cheaper weapon of the same style group, searched for every phase of the group, in the group's armour
      const weaponId = getCanonicalItemId(weapon.id);
      if (required.has(weaponId) || groups.some((g) => g !== group && g.items.includes(weaponId))) continue;
      const styleGroup = (st: BestStyle) => (st === 'ranged' || st === 'magic' ? st : 'melee');
      const others = new Map<number, Candidate[]>();
      group.units.forEach((u, i) => input.candidates.filter((x) => x.phaseKey === u.pick.key
        && styleGroup(x.style) === styleGroup(u.candidate.style)
        && getCanonicalItemId(x.setup.player.equipment.weapon!.id) !== weaponId
        && !excluded.has(getCanonicalItemId(x.setup.player.equipment.weapon!.id)))
        .forEach((x) => {
          const id = getCanonicalItemId(x.setup.player.equipment.weapon!.id);
          const list = others.get(id) ?? [];
          // the phase's fastest setup of the weapon, one per unit
          if (!list[i] || list[i].dps < x.dps) list[i] = x;
          others.set(id, list);
        }));
      const weaponTries = [...others.entries()].filter(([, list]) => group.units.every((_, i) => list[i]))
        .map(([id, list]) => {
          const next = group.units.map((u, i) => inGearOf(u, list[i]));
          const items = next.every((n) => n) ? [...new Set(next.flatMap((n) => n!.itemIds))] : null;
          return {
            id, next, items, saving: items ? cost - costOf(loadout({ group, items })) : 0,
          };
        })
        .filter((o) => o.items && o.saving > 0 && loadout({ group, items: o.items }).size <= Math.max(maxItems, current.size))
        .sort((a, b) => b.saving - a.saving)
        .slice(0, CHEAPER_TRIES);
      for (const o of weaponTries) {
        if (best && o.saving <= best.saving) break;
        // eslint-disable-next-line no-await-in-loop
        const rated = await Promise.all(group.units.map((u, i) => rate([o.next[i]!.setup], u.monster).then(([d]) => ({ ...o.next[i]!, dps: d }))));
        if (-gainOf(group, rated) > allowedLoss(o.saving)) continue;
        best = { group, rated, saving: o.saving };
        break;
      }
    }
    if (!best) return false;
    const { group, rated } = best;
    group.units.forEach((u, i) => {
      // eslint-disable-next-line no-param-reassign
      u.candidate = rated[i];
    });
    group.items = [...new Set(rated.flatMap((x) => x.itemIds))];
    group.moves = await movesFor(group);
    return true;
  };
  let cheapened = 0;
  await startStep('Swapping for cheaper items');
  // eslint-disable-next-line no-await-in-loop
  while (cheapened < MAX_CHEAPEN && await cheapen()) cheapened += 1;
  if (camped > 0 || cheapened > 0) {
    for (const group of groups) {
      // eslint-disable-next-line no-await-in-loop
      group.moves = await movesFor(group);
    }
    await climb();
  }
  /**
   * The climb buys greedily, by time per gp, and never gives an item back: an expensive piece bought early (Avernic
   * treads) can stand where the money would buy more time elsewhere, a better weapon most of all. Each of the most
   * expensive armour pieces is tried back for the cheaper item that loses least in each setup wearing it, the freed
   * money spent by the climb and the weapon step again; the raid as it was comes back unless that is faster.
   */
  const raidTime = () => groups.reduce((n, g) => n + g.units.reduce((m, u) => m + seconds(u.pick.hp, u.candidate.dps), 0), 0);
  const snapshot = () => {
    const kept = groups.map((g) => ({
      g, units: [...g.units], candidates: g.units.map((u) => u.candidate), items: g.items, moves: g.moves,
    }));
    return () => {
      groups.splice(0, groups.length, ...kept.map((k) => k.g));
      kept.forEach((k) => {
        Object.assign(k.g, { units: k.units, items: k.items, moves: k.moves });
        k.units.forEach((u, i) => {
          // eslint-disable-next-line no-param-reassign
          u.candidate = k.candidates[i];
        });
      });
    };
  };
  const sellBack = async (id: number): Promise<boolean> => {
    const wearing = groups.filter((g) => g.items.includes(id));
    const changes = wearing.map((group) => group.moves
      .filter((m) => m.slot !== 'stance' && m.from === id && priceOf(m.to) < priceOf(id))
      .reduce<Move | null>((a, m) => (!a || gainOf(group, m.next) > gainOf(group, a.next) ? m : a), null));
    if (wearing.length === 0 || changes.some((m) => !m)) return false;
    const before = raidTime();
    const restore = snapshot();
    wearing.forEach((group, i) => {
      const move = changes[i]!;
      group.units.forEach((u, j) => {
        // eslint-disable-next-line no-param-reassign
        u.candidate = move.next[j];
      });
      group.items = swapped(group.items, move);
    });
    for (const group of groups) {
      // eslint-disable-next-line no-await-in-loop
      group.moves = await movesFor(group);
    }
    // the weapon step first: the climb alone would buy the item straight back
    // eslint-disable-next-line no-await-in-loop
    for (let round = 0; round < MAX_WEAPON_ADDS && await addWeapons(); round++) await climb();
    await climb();
    if (raidTime() < before - SELL_BACK_SECONDS) return true;
    restore();
    return false;
  };
  await startStep('Selling back expensive items');
  const expensive = [...loadout()]
    .filter((id) => !required.has(id) && priceOf(id) > FREE_PRICE
      && groups.some((g) => g.units[0].candidate.setup.player.equipment.weapon?.id !== undefined
        && g.items.includes(id) && getCanonicalItemId(g.units[0].candidate.setup.player.equipment.weapon.id) !== id))
    .sort((a, b) => priceOf(b) - priceOf(a))
    .slice(0, MAX_SELL_BACK);
  for (const id of expensive) {
    // eslint-disable-next-line no-await-in-loop
    await sellBack(id);
  }

  /**
   * A setup's kit built up as a whole: pieces that each save too little for their cell (or nothing, short of a max hit)
   * can together, like melee armour over the ranged for all of a melee phase. Changes that save the most time per gp go
   * in one at a time, then ones that only add the style's bonuses towards the next max hit; the kit keeps the longest
   * run of them that saves more than its new cells must.
   */
  const kit = async (group: Group): Promise<boolean> => {
    type State = { candidates: Candidate[]; items: number[]; moves: Move[] };
    const save = (): State => ({ candidates: group.units.map((u) => u.candidate), items: group.items, moves: group.moves });
    const restore = (st: State) => {
      group.units.forEach((u, i) => {
        // eslint-disable-next-line no-param-reassign
        u.candidate = st.candidates[i];
      });
      Object.assign(group, { items: st.items, moves: st.moves });
    };
    const start = save();
    const timeOf = () => group.units.reduce((n, u) => n + seconds(u.pick.hp, u.candidate.dps), 0);
    const startTime = timeOf();
    const states: { state: State; net: number }[] = [];
    let bar = 0;
    for (let step = 0; step < MAX_KIT; step++) {
      const current = loadout();
      const cost = costOf(current);
      const cap = Math.max(budget, cost);
      const value = valueFor(group.units[0].candidate);
      const { equipment } = group.units[0].candidate.setup.player;
      const options = group.moves.filter((m) => m.slot !== 'stance').map((move) => {
        const next = loadout({ group, items: swapped(group.items, move) });
        const from = equipment[move.slot as GearSlot];
        const to = move.next[0].setup.player.equipment[move.slot as GearSlot];
        return {
          move, next, gain: gainOf(group, move.next), more: to ? value(to) - (from ? value(from) : 0) : 0, extra: costOf(next) - cost,
        };
      }).filter((o) => costOf(o.next) <= cap && o.next.size <= Math.max(maxItems, current.size)
        && Number.isFinite(o.gain) && o.gain > -MIN_GAIN);
      const saving = options.filter((o) => o.gain > MIN_GAIN);
      const pick = saving.length > 0
        ? saving.reduce((a, b) => (b.gain / (Math.max(0, b.extra) + COST_SMOOTHING) > a.gain / (Math.max(0, a.extra) + COST_SMOOTHING) ? b : a))
        : options.filter((o) => o.more > 0)
          .reduce<typeof options[number] | null>((a, b) => (!a || b.more / (Math.max(0, b.extra) + COST_SMOOTHING) > a.more / (Math.max(0, a.extra) + COST_SMOOTHING) ? b : a), null);
      if (!pick) break;
      const cells = pick.next.size - current.size;
      bar += Math.max(0, cells) * (filling || isFree(pick.move.to) ? FILL_SECONDS : switchSeconds(pick.move.slot)) + moneyBar(pick.extra);
      group.units.forEach((u, i) => {
        // eslint-disable-next-line no-param-reassign
        u.candidate = pick.move.next[i];
      });
      group.items = swapped(group.items, pick.move);
      // eslint-disable-next-line no-await-in-loop
      group.moves = await movesFor(group);
      states.push({ state: save(), net: startTime - timeOf() - bar });
    }
    const best = states.reduce<typeof states[number] | null>((a, b) => (b.net > (a?.net ?? MIN_GAIN) ? b : a), null);
    restore(best?.state ?? start);
    return !!best;
  };
  const kits = async () => {
    let changed = false;
    for (const group of [...groups]) {
      // eslint-disable-next-line no-await-in-loop
      if (await kit(group)) changed = true;
    }
    if (changed) await climb();
  };
  await startStep('Building kits');
  await kits();
  // the passes since the cheaper swaps (giving back, kits) can leave a setup on its own with an item a much cheaper one
  // matches, the Armadyl crossbow beside the Dragon crossbow: once more on the final setups, and the money spent again
  let lateCheapened = 0;
  // eslint-disable-next-line no-await-in-loop
  while (lateCheapened < MAX_CHEAPEN && await cheapen()) lateCheapened += 1;
  if (lateCheapened > 0) await climb();
  // bag cells and money left: switches that save less than a cell is normally worth, the most time per gp first
  if (loadout().size < maxItems && costOf(loadout()) < budget) {
    filling = true;
    await startStep('Filling free cells');
    await climb();
    await kits();
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
