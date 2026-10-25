import {
  AmmoApplicability, ammoApplicability, availableEquipment, getCanonicalItemId,
} from '@/lib/Equipment';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { MonsterAttribute } from '@/enums/MonsterAttribute';
import { Monster } from '@/types/Monster';
import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { CombatStyleStance, PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { isBindSpell, spells } from '@/types/Spell';
import { getCombatStylesForCategory } from '@/utils';
import { effectSignature, hasNamedEffect, isEffectItem } from '@/best/lib/effectItems';
import { BestStyle } from '@/best/types';

export type GearSlot = Exclude<keyof PlayerEquipment, 'weapon'>;

/** One weapon setup to search around: the weapon, its stance and what it fires or casts. */
export interface WeaponJob {
  style: BestStyle;
  weaponId: number;
  combatStyle: PlayerCombatStyle;
  ammoId: number | null;
  spellName: string | null;
  dartId: number | null;
}

const EXCLUDED_VERSIONS = new Set(['Uncharged', 'Inactive', 'Deadman Mode', 'Cosmetic', 'Broken']);
// Deadman copies are often listed under their own name with no Deadman version, e.g. "Armadyl godsword (Deadman)";
// historical items (the pre-Prifddinas Crystal bow and shield) no longer exist
const EXCLUDED_NAME = /\(unobtainable item\)|\(beta\)|\(historical\)|\(deadman( mode)?\)/i;
const EXCLUDED_ITEM_IDS = new Set([
  21433, // Wilderness champion amulet: +100 to every attack from a past event, not obtainable in normal play
  // minigame-only ammo: Barbarian Assault's Bullet, Field, Blunt and Barbed arrow (upstream lets bows fire them)
  22227, 22228, 22229, 22230,
  // minigame-only ammo: Castle wars arrow and bolts
  30694, 30696,
  // minigame-only gear: The Gauntlet's Crystal dagger (perfected), sceptres and tools (names checked against equipment.json)
  30340, 23820, 23861, 23821, 23822, 23823, 23862, 23863, 23864,
]);
// minigame-only gear: The Gauntlet's tiered weapons and armour, which can't leave it
const GAUNTLET_ONLY = /^(Corrupted|Crystal) (halberd|bow|staff|helm|body|legs) \((basic|attuned|perfected)\)$/;

// not real gear: wrapped gloves are a gift-wrapped copy, Nightmare Zone (nz) items can't leave the Nightmare Zone
const NOT_REAL = /\((wrapped|nz)\)/;

// left out for now: every Corrupted item (Gauntlet, PvP and Deadman copies, Corrupted Scythe of Vitur)
const CORRUPTED = /^Corrupted /;

/**
 * PvP-only gear: Bounty Hunter copies (bh), which only work on Bounty Hunter worlds, and the Vesta's, Statius's, Morrigan's and Zuriel's gear in every variant (plain, (bh), Corrupted, Deadman, blighted), which comes from LMS, Deadman and Bounty Hunter and works only in PvP areas.
 */
export const isPvpOnly = (item: EquipmentPiece): boolean => /\(bh\)/.test(item.name) || /^(Corrupted )?(Vesta|Statius|Morrigan|Zuriel)'s /i.test(item.name);

/**
 * The items the search may use: canonical items, without uncharged, inactive, broken, Deadman, cosmetic, unobtainable,
 * minigame-only, PvP-only, not real, Corrupted or excluded ones.
 */
export const bestPool = (items: EquipmentPiece[] = availableEquipment): EquipmentPiece[] => items.filter((e) => getCanonicalItemId(e.id) === e.id
  && !EXCLUDED_VERSIONS.has(e.version)
  && !EXCLUDED_NAME.test(e.name)
  && !EXCLUDED_ITEM_IDS.has(e.id)
  && !GAUNTLET_ONLY.test(e.name)
  && !NOT_REAL.test(e.name)
  && !CORRUPTED.test(e.name)
  && !isPvpOnly(e)
  // data artefacts held in the weapon slot: greegrees, Gnomeball (-1), crates and Christmas dinner (0)
  && !(e.slot === 'weapon' && e.speed <= 1));

/** What gear is scored on: the job's style, or 'rangedStrength' for ranged weapons that hit with the melee strength bonus. */
export type ScoreKind = BestStyle | 'rangedStrength';

// ranged weapons whose max hit uses the melee strength bonus instead of ranged strength (getPlayerMaxRangedHit's scalesWithStr)
const RANGED_WITH_STRENGTH = new Set(['Eclipse atlatl', "Hunter's spear"]);

/** How gear is scored for `weapon` attacking with `style`. */
export const scoreKind = (weapon: EquipmentPiece, style: BestStyle): ScoreKind => (
  style === 'ranged' && RANGED_WITH_STRENGTH.has(weapon.name) ? 'rangedStrength' : style
);

/** The two numbers an item contributes to `style` through its bonuses. */
export const styleScore = (item: EquipmentPiece, style: ScoreKind): [attack: number, strength: number] => {
  switch (style) {
    case 'ranged':
      return [item.offensive.ranged, item.bonuses.ranged_str];
    case 'rangedStrength':
      return [item.offensive.ranged, item.bonuses.str];
    case 'magic':
      return [item.offensive.magic, item.bonuses.magic_str];
    default:
      return [item.offensive[style], item.bonuses.str];
  }
};

/**
 * Keeps the items no other item matches-or-beats on every number; of items with equal numbers only the lowest id stays.
 * Output is sorted by id.
 */
const paretoBy = (items: EquipmentPiece[], score: (item: EquipmentPiece) => number[]): EquipmentPiece[] => {
  const sorted = [...items].sort((a, b) => a.id - b.id);
  const scores = sorted.map(score);
  return sorted.filter((_, i) => !scores.some((other, j) => {
    if (j === i || other.some((v, k) => v < scores[i][k])) return false;
    // equal on every number: the earlier (lower id) one wins
    return other.some((v, k) => v > scores[i][k]) || j < i;
  }));
};

export const paretoFront = (items: EquipmentPiece[], style: ScoreKind): EquipmentPiece[] => paretoBy(items, (e) => styleScore(e, style));

/** Per-slot candidates: the dominance-pruned plain items and every effect item (Task 4 decides which effects matter). */
export const slotCandidates = (pool: EquipmentPiece[], style: ScoreKind, slot: GearSlot): { plain: EquipmentPiece[]; effect: EquipmentPiece[] } => {
  const items = pool.filter((e) => e.slot === slot);
  return {
    plain: paretoFront(items.filter((e) => !isEffectItem(e)), style),
    effect: items.filter(isEffectItem).sort((a, b) => a.id - b.id),
  };
};

// Weapons whose magic attack is built in: they cast no spell
const BUILT_IN_MAGIC = new Set([EquipmentCategory.POWERED_STAFF, EquipmentCategory.POWERED_WAND, EquipmentCategory.SALAMANDER]);

// Spells the engine checks by name; they are candidates on top of the strongest spell per element
const NAMED_SPELLS = new Set([
  'Saradomin Strike', 'Claws of Guthix', 'Flames of Zamorak', 'Iban Blast', 'Magic Dart', 'Crumble Undead',
  'Inferior Demonbane', 'Superior Demonbane', 'Dark Demonbane', 'Ghostly Grasp', 'Skeletal Grasp', 'Undead Grasp',
]);

const strongest = (list: typeof spells) => list.reduce((best, s) => (s.max_hit > best.max_hit ? s : best));

/** Strongest standard spell per element, every ancient barrage, and the named spells; binds and curses are skipped. */
const SPELL_CANDIDATES: string[] = (() => {
  const castable = spells.filter((s) => !isBindSpell(s) && (s.max_hit > 0 || NAMED_SPELLS.has(s.name)));
  const standard = castable.filter((s) => s.spellbook === 'standard' && s.element);
  const perElement = [...new Set(standard.map((s) => s.element))]
    .map((el) => strongest(standard.filter((s) => s.element === el)).name);
  const barrages = castable.filter((s) => s.spellbook === 'ancient' && s.name.endsWith(' Barrage')).map((s) => s.name);
  const named = castable.filter((s) => NAMED_SPELLS.has(s.name)).map((s) => s.name);
  return [...new Set([...perElement, ...barrages, ...named])].sort();
})();

// The Twinflame staff adds a second hitsplat to standard Bolt, Blast and Wave spells, so those tiers can beat Surges
const TWINFLAME_SPELL_CANDIDATES: string[] = [...new Set([
  ...SPELL_CANDIDATES,
  ...spells.filter((s) => s.spellbook === 'standard' && s.element && /( Bolt| Blast| Wave)$/.test(s.name)).map((s) => s.name),
])].sort();

/**
 * Spells only some weapons can cast, with those weapons, as BaseCalc's spell-weapon check lists them. Names compare case-insensitively, as upstream intends (some of its names differ from the data in case).
 * Upstream checks 'Flames of Zamarok', so it lets any weapon cast Flames of Zamorak; only the Zamorak staves really can.
 */
const WEAPON_LOCKED_SPELLS: Record<string, string[]> = {
  'Iban Blast': ["Iban's staff", "Iban's staff (u)"],
  'Saradomin Strike': ['Saradomin staff', 'Staff of Light'],
  'Claws of Guthix': ['Guthix staff', 'Void knight mace', 'Staff of balance'],
  'Flames of Zamorak': ['Zamorak staff', 'Staff of the dead', 'Toxic staff of the dead', "Thammaron's sceptre (a)", 'Accursed sceptre (a)'],
  'Magic Dart': ["Slayer's staff", "Slayer's staff (e)", 'Staff of the Dead', 'Toxic staff of the Dead', 'Staff of Light', 'Staff of Balance'],
};

const canCast = (weapon: EquipmentPiece, spellName: string): boolean => {
  const weapons = WEAPON_LOCKED_SPELLS[spellName];
  return !weapons || weapons.some((w) => w.toLowerCase() === weapon.name.toLowerCase());
};

/** Whether the engine lets `spellName` hit `monster`: demonbane spells need a demon, Crumble Undead an undead. */
const canTarget = (spellName: string, monster: Monster): boolean => {
  if (spellName.includes('Demonbane')) return monster.attributes.includes(MonsterAttribute.DEMON);
  if (spellName === 'Crumble Undead') return monster.attributes.includes(MonsterAttribute.UNDEAD);
  return true;
};

// Stances that add no offence: melee Defensive, ranged and powered-staff Longrange, Defensive Autocast
const NO_OFFENCE: Record<'melee' | 'ranged' | 'magic', ReadonlySet<CombatStyleStance>> = {
  melee: new Set(['Defensive']),
  ranged: new Set(['Longrange']),
  magic: new Set(['Longrange', 'Defensive Autocast']),
};

/** The stances of `weapon` that attack with `style` and add offence, one per stance; empty when it can't. */
const stancesFor = (weapon: EquipmentPiece, style: BestStyle): PlayerCombatStyle[] => {
  const group = style === 'ranged' || style === 'magic' ? style : 'melee';
  const all = getCombatStylesForCategory(weapon.category)
    .filter((s) => s.type === style && !NO_OFFENCE[group].has(s.stance));
  let styles = all;
  if (style === 'magic') {
    const real = all.filter((s) => s.stance !== 'Manual Cast');
    if (real.length > 0) {
      styles = real;
    } else if (weapon.bonuses.magic_str > 0) {
      // every weapon can manually cast; only those with magic strength are worth a job
      styles = all;
    } else {
      styles = [];
    }
  }
  // powered staves list the same stance twice; identical stances calculate identically
  return styles.filter((s, i) => styles.findIndex((o) => o.stance === s.stance) === i);
};

// Variant suffixes the engine never checks names with: poison, karambwan poison, charges
const VARIANT_SUFFIX = /\s*\((p\+{0,2}|kp|\d+)\)$/;

/**
 * Poison and charge variants of one weapon calculate identically when their stats match; the engine only checks the
 * 'Charged' version, so that stays apart.
 */
const variantKey = (weapon: EquipmentPiece) => JSON.stringify([
  weapon.name.replace(VARIANT_SUFFIX, ''),
  weapon.version === 'Charged',
  weapon.offensive,
  weapon.defensive,
  weapon.bonuses,
  weapon.speed,
]);

const ammoKind = (ammo: EquipmentPiece) => {
  if (/\barrows?\b/i.test(ammo.name)) return 'arrow';
  if (/\bbolts?\b/i.test(ammo.name)) return 'bolt';
  return 'other';
};

/** Dominance-pruned within each group of `items` with the same `key`. */
const paretoWithin = (items: EquipmentPiece[], key: (a: EquipmentPiece) => string) => [...new Set(items.map(key))]
  .flatMap((k) => paretoFront(items.filter((a) => key(a) === k), 'ranged'));

/**
 * Plain ammo is dominance-pruned among ammo of the same kind, ammo the engine names among ammo matching the same name
 * checks (the Silver bolts versions, the Seeking arrow tiers), since those checks can't tell them apart.
 */
const ammoCandidates = (valid: EquipmentPiece[]): number[] => {
  const named = valid.filter(hasNamedEffect);
  const plain = valid.filter((a) => !hasNamedEffect(a));
  return [...paretoWithin(plain, ammoKind), ...paretoWithin(named, (a) => `${ammoKind(a)} ${effectSignature(a)}`)]
    .map((a) => a.id).sort((a, b) => a - b);
};

const requiresAmmo = (weapon: EquipmentPiece) => ammoApplicability(weapon.id, undefined) !== AmmoApplicability.ALLOWED;

/**
 * Weapon setups for `style`. Interchangeable variants (poison, charges) collapse to one. Weapons the engine names are
 * all kept; the rest are dominance-pruned on (attack, strength, -speed) among weapons that are otherwise
 * interchangeable: same handedness, category, stances, ammo and kind of magic. A category effect (bolt procs,
 * chinchompa fuses, powered staves, ...) is the same for every weapon of the category. Ranged weapons that take ammo
 * get one job per candidate ammo, blowpipes one per candidate dart, spellcasting weapons one per candidate spell.
 * Sorted by weapon id, then stance order, then ammo/dart id or spell name.
 * Weapon-locked spells pair only with their weapons; with `monster`, spells that can't hit it (demonbane, Crumble Undead) are left out.
 */
export const weaponJobs = (pool: EquipmentPiece[], style: BestStyle, monster?: Monster): WeaponJob[] => {
  const ammo = pool.filter((e) => e.slot === 'ammo');
  const validAmmoCache = new Map<number, EquipmentPiece[]>();
  const validAmmo = (weapon: EquipmentPiece) => {
    let valid = validAmmoCache.get(weapon.id);
    if (!valid) {
      valid = ammo.filter((a) => ammoApplicability(weapon.id, a.id) === AmmoApplicability.INCLUDED);
      validAmmoCache.set(weapon.id, valid);
    }
    return valid;
  };

  const allWeapons = pool.filter((e) => e.slot === 'weapon')
    .map((weapon) => ({ weapon, stances: stancesFor(weapon, style) }))
    .filter((w) => w.stances.length > 0)
    .sort((a, b) => a.weapon.id - b.weapon.id);

  // weapons only compete with weapons they could replace one-for-one
  const groupKey = ({ weapon, stances }: typeof allWeapons[number]) => JSON.stringify([
    weapon.isTwoHanded,
    weapon.category,
    stances.map((s) => s.stance),
    style === 'ranged' ? validAmmo(weapon).map((a) => a.id).sort((a, b) => a - b) : null,
    BLOWPIPE_IDS.includes(weapon.id),
    BUILT_IN_MAGIC.has(weapon.category),
  ]);
  // of interchangeable variants only the lowest id stays
  const seenVariants = new Set<string>();
  const weapons = allWeapons.filter((w) => {
    const key = groupKey(w) + variantKey(w.weapon);
    if (seenVariants.has(key)) return false;
    seenVariants.add(key);
    return true;
  });
  const groups = new Map<string, EquipmentPiece[]>();
  weapons.filter((w) => !hasNamedEffect(w.weapon)).forEach((w) => {
    const key = groupKey(w);
    groups.set(key, [...(groups.get(key) ?? []), w.weapon]);
  });
  const keptPlain = new Set([...groups.values()]
    .flatMap((group) => paretoBy(group, (e) => [...styleScore(e, style), -e.speed]))
    .map((e) => e.id));
  const kept = weapons.filter((w) => hasNamedEffect(w.weapon) || keptPlain.has(w.weapon.id));

  const darts = pool.filter((e) => e.slot === 'weapon' && e.category === EquipmentCategory.THROWN && e.name.endsWith(' dart'));
  // a blowpipe takes only the dart's ranged strength
  const dartIds = [
    ...paretoBy(darts.filter((d) => !isEffectItem(d)), (d) => [d.bonuses.ranged_str]),
    ...darts.filter(isEffectItem),
  ].map((d) => d.id).sort((a, b) => a - b);

  return kept.flatMap(({ weapon, stances }) => {
    type Extra = Pick<WeaponJob, 'ammoId' | 'spellName' | 'dartId'>;
    let extras: Extra[] = [{ ammoId: null, spellName: null, dartId: null }];
    if (style === 'ranged' && BLOWPIPE_IDS.includes(weapon.id)) {
      extras = dartIds.map((dartId) => ({ ammoId: null, spellName: null, dartId }));
    } else if (style === 'ranged' && requiresAmmo(weapon)) {
      extras = ammoCandidates(validAmmo(weapon)).map((ammoId) => ({ ammoId, spellName: null, dartId: null }));
    } else if (style === 'magic' && !BUILT_IN_MAGIC.has(weapon.category)) {
      extras = (weapon.name === 'Twinflame staff' ? TWINFLAME_SPELL_CANDIDATES : SPELL_CANDIDATES)
        .filter((spellName) => canCast(weapon, spellName) && (!monster || canTarget(spellName, monster)))
        .map((spellName) => ({ ammoId: null, spellName, dartId: null }));
    }
    return stances.flatMap((combatStyle) => extras.map((extra) => ({
      style, weaponId: weapon.id, combatStyle, ...extra,
    })));
  });
};
