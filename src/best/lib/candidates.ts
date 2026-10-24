import { AmmoApplicability, ammoApplicability } from '@/lib/Equipment';
import { BLOWPIPE_IDS } from '@/lib/constants';
import { EquipmentCategory, MAGIC_WEAPONS } from '@/enums/EquipmentCategory';
import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { PlayerCombatStyle } from '@/types/PlayerCombatStyle';
import { isBindSpell, spells } from '@/types/Spell';
import { getCombatStylesForCategory } from '@/utils';
import { isEffectItem } from '@/best/lib/effectItems';
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

/** The two numbers an item contributes to `style` through its bonuses. */
export const styleScore = (item: EquipmentPiece, style: BestStyle): [attack: number, strength: number] => {
  switch (style) {
    case 'ranged':
      return [item.offensive.ranged, item.bonuses.ranged_str];
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

export const paretoFront = (items: EquipmentPiece[], style: BestStyle): EquipmentPiece[] => paretoBy(items, (e) => styleScore(e, style));

/** Per-slot candidates: the dominance-pruned plain items and every effect item (Task 4 decides which effects matter). */
export const slotCandidates = (pool: EquipmentPiece[], style: BestStyle, slot: GearSlot): { plain: EquipmentPiece[]; effect: EquipmentPiece[] } => {
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

/** The stances of `weapon` that attack with `style`, one per stance; empty when it can't. */
const stancesFor = (weapon: EquipmentPiece, style: BestStyle): PlayerCombatStyle[] => {
  const all = getCombatStylesForCategory(weapon.category).filter((s) => s.type === style);
  let styles = all;
  if (style === 'magic') {
    const real = all.filter((s) => s.stance !== 'Manual Cast');
    if (real.some((s) => s.stance === 'Autocast')) {
      styles = real.filter((s) => s.stance !== 'Defensive Autocast');
    } else if (real.length > 0) {
      styles = real;
    } else if (MAGIC_WEAPONS.includes(weapon.category) || weapon.offensive.magic > 0 || weapon.bonuses.magic_str > 0) {
      // every weapon can manually cast; only weapons that help magic are worth a job
      styles = all;
    } else {
      styles = [];
    }
  }
  // powered staves list the same stance twice; identical stances calculate identically
  return styles.filter((s, i) => styles.findIndex((o) => o.stance === s.stance) === i);
};

const requiresAmmo = (weapon: EquipmentPiece) => ammoApplicability(weapon.id, undefined) !== AmmoApplicability.ALLOWED;

/**
 * Weapon setups for `style`. Effect weapons are all kept; plain weapons are dominance-pruned on (attack, strength,
 * -speed) among weapons that are otherwise interchangeable: same handedness, stances, ammo and kind of magic.
 * Ranged weapons that take ammo get one job per candidate ammo, blowpipes one per candidate dart, spellcasting
 * weapons one per candidate spell. Sorted by weapon id, then stance order, then ammo/dart id or spell name.
 */
export const weaponJobs = (pool: EquipmentPiece[], style: BestStyle): WeaponJob[] => {
  const ammo = pool.filter((e) => e.slot === 'ammo');
  const validAmmo = (weapon: EquipmentPiece) => ammo.filter((a) => ammoApplicability(weapon.id, a.id) === AmmoApplicability.INCLUDED);

  const weapons = pool.filter((e) => e.slot === 'weapon')
    .map((weapon) => ({ weapon, stances: stancesFor(weapon, style) }))
    .filter((w) => w.stances.length > 0);

  // plain weapons only compete with weapons they could replace one-for-one
  const groupKey = ({ weapon, stances }: typeof weapons[number]) => JSON.stringify([
    weapon.isTwoHanded,
    stances.map((s) => s.stance),
    style === 'ranged' ? validAmmo(weapon).map((a) => a.id).sort((a, b) => a - b) : null,
    BLOWPIPE_IDS.includes(weapon.id),
    BUILT_IN_MAGIC.has(weapon.category),
  ]);
  const groups = new Map<string, EquipmentPiece[]>();
  weapons.filter((w) => !isEffectItem(w.weapon)).forEach((w) => {
    const key = groupKey(w);
    groups.set(key, [...(groups.get(key) ?? []), w.weapon]);
  });
  const keptPlain = new Set([...groups.values()]
    .flatMap((group) => paretoBy(group, (e) => [...styleScore(e, style), -e.speed]))
    .map((e) => e.id));
  const kept = weapons.filter((w) => isEffectItem(w.weapon) || keptPlain.has(w.weapon.id))
    .sort((a, b) => a.weapon.id - b.weapon.id);

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
      const valid = validAmmo(weapon);
      extras = [...paretoFront(valid.filter((a) => !isEffectItem(a)), 'ranged'), ...valid.filter(isEffectItem)]
        .map((a) => a.id).sort((a, b) => a - b)
        .map((ammoId) => ({ ammoId, spellName: null, dartId: null }));
    } else if (style === 'magic' && !BUILT_IN_MAGIC.has(weapon.category)) {
      extras = SPELL_CANDIDATES.map((spellName) => ({ ammoId: null, spellName, dartId: null }));
    }
    return stances.flatMap((combatStyle) => extras.map((extra) => ({
      style, weaponId: weapon.id, combatStyle, ...extra,
    })));
  });
};
