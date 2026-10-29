/**
 * Which spec weapon is best on each phase: the spec's damage per second (expected damage over the weapon's attack
 * time), on the phase's best setup of the weapon's style. Defence reduction weapons are left out. Main thread only (it runs computeRow on the pools).
 */
import {
  AmmoApplicability, ammoApplicability, calculateAttackSpeed, WEAPON_SPEC_COSTS,
} from '@/lib/Equipment';
import { EquipmentPiece } from '@/types/Player';
import { getCombatStylesForCategory } from '@/utils';
import { bestPool } from '@/best/lib/candidates';
import { BestRunDeps } from '@/best/lib/run';
import { hashKey } from '@/best/lib/resultCache';
import { BulkSetup, GEAR_SLOT_ORDER } from '@/bulk/types';
import { DEFENCE_WEAPON_IDS, RoutePhase } from '@/raid/types';
import { Candidate } from '@/raid/lib/candidates';
import { SearchCache } from '@/raid/lib/searchCache';

export interface SpecRank {
  weaponId: number;
  /** Spec energy, in % */
  cost: number;
  /** Expected damage of one spec */
  expected: number;
  /** Expected damage per second of the spec's attack */
  dps: number;
}

const SECONDS_PER_TICK = 0.6;

/** Best first by the spec's damage per second, so a slow weapon's big spec ranks below a fast one's; no-damage specs are left out */
export const rankSpecs = (specs: (Omit<SpecRank, 'dps'> & { ticks: number })[]): SpecRank[] => specs
  .filter((s) => s.expected > 0 && s.cost > 0)
  .map(({ ticks, ...s }) => ({ ...s, dps: s.expected / (ticks * SECONDS_PER_TICK) }))
  .sort((a, b) => b.dps - a.dps);

type Group = 'melee' | 'ranged' | 'magic';
// every weapon can manual cast, so magic counts only when the weapon has no melee or ranged stance
const groupOfWeapon = (w: EquipmentPiece): Group => {
  const types = getCombatStylesForCategory(w.category).map((s) => s.type);
  if (types.includes('ranged')) return 'ranged';
  if (types.some((t) => t === 'stab' || t === 'slash' || t === 'crush')) return 'melee';
  return 'magic';
};
const groupOfStyle = (style: string): Group => (style === 'ranged' || style === 'magic' ? style : 'melee');

let specWeapons: EquipmentPiece[] | null = null;
let ammo: EquipmentPiece[] = [];
const loadPool = () => {
  if (!specWeapons) {
    const pool = bestPool();
    const defence = new Set(Object.values(DEFENCE_WEAPON_IDS));
    specWeapons = pool.filter((e) => e.slot === 'weapon' && WEAPON_SPEC_COSTS[e.name] !== undefined && !defence.has(e.id));
    ammo = pool.filter((e) => e.slot === 'ammo');
  }
  return specWeapons;
};

const DRAGON_DART = 11230;

/** Ammo to spec with: the setup's if the weapon fires it, else the strongest it does, and every enchanted bolt as strong (a bolt spec rides on its effect) */
const ammoOptions = (weapon: EquipmentPiece, current: EquipmentPiece | null): (EquipmentPiece | null)[] => {
  const valid = ammo.filter((a) => ammoApplicability(weapon.id, a.id) === AmmoApplicability.INCLUDED)
    .sort((a, b) => b.bonuses.ranged_str - a.bonuses.ranged_str);
  const fires = ammoApplicability(weapon.id, current?.id) !== AmmoApplicability.INVALID;
  const base = fires ? current : (valid[0] ?? null);
  const strength = base?.bonuses.ranged_str ?? 0;
  const enchanted = valid.filter((a) => a.id !== base?.id && /\(e\)$/.test(a.name) && a.bonuses.ranged_str >= strength);
  return [base, ...enchanted];
};

/** The candidate's setup with `weapon` in hand and `ammoItem`: a stance of the candidate's attack type if it has one */
const withWeapon = (c: Candidate, weapon: EquipmentPiece, ammoItem: EquipmentPiece | null): BulkSetup => {
  const { player } = c.setup;
  const stances = getCombatStylesForCategory(weapon.category);
  const style = stances.find((s) => s.type === player.style.type) ?? stances.find((s) => groupOfStyle(s.type ?? '') === groupOfWeapon(weapon)) ?? stances[0];
  const hand = /blowpipe/i.test(weapon.name)
    ? { ...weapon, itemVars: { blowpipeDartId: DRAGON_DART, blowpipeDartName: 'Dragon dart' } }
    : weapon;
  return {
    id: `spec-${c.phaseKey}-${weapon.id}-${ammoItem?.id ?? 0}`,
    name: weapon.name,
    player: {
      ...player,
      style,
      spell: null,
      equipment: {
        ...player.equipment, weapon: hand, ammo: ammoItem, shield: weapon.isTwoHanded ? null : player.equipment.shield,
      },
    },
  };
};

const specKey = (phase: RoutePhase, setup: BulkSetup) => `spec:${hashKey(JSON.stringify({
  monster: phase.monster.monster,
  gear: GEAR_SLOT_ORDER.map((slot) => setup.player.equipment[slot]?.id ?? null),
  style: setup.player.style,
}))}`;

/**
 * Per phase key, the spec weapons ranked by the spec's damage per second. Spec damage comes from computeRow on the rows pool
 * (concurrently), cached in `cache` so a re-plan computes nothing again.
 */
export const specRanking = async (
  phases: RoutePhase[],
  candidates: Candidate[],
  excluded: number[],
  deps: BestRunDeps,
  cache: SearchCache,
): Promise<Record<string, SpecRank[]>> => {
  const leftOut = new Set(excluded);
  const weapons = loadPool().filter((w) => !leftOut.has(w.id));
  const out: Record<string, SpecRank[]> = {};
  await Promise.all(phases.map(async (phase) => {
    const key = phase.phase.key;
    // per style group, the phase's fastest setup
    const best = new Map<Group, Candidate>();
    const allowed = phase.phase.allowedStyles;
    candidates.filter((c) => c.phaseKey === key && (!allowed || allowed.includes(c.style))).forEach((c) => {
      const g = groupOfStyle(c.style);
      if (!best.has(g) || c.dps > best.get(g)!.dps) best.set(g, c);
    });
    const setups = weapons.flatMap((w) => {
      const base = best.get(groupOfWeapon(w));
      return base ? ammoOptions(w, base.setup.player.equipment.ammo).map((a) => ({ weapon: w, setup: withWeapon(base, w, a) })) : [];
    });
    const missing = setups.filter((s) => cache.getSpec(specKey(phase, s.setup)) === undefined);
    if (missing.length > 0) {
      const rows = await deps.rows.run(missing.map((s) => s.setup), [phase.monster], () => {}, { concurrent: true });
      const byId = new Map((rows ?? []).map((r) => [r.setupId, r]));
      missing.forEach((s) => cache.setSpec(specKey(phase, s.setup), byId.get(s.setup.id)?.spec?.expected ?? 0));
    }
    // each weapon with its best ammo
    const byWeapon = new Map<number, { setup: BulkSetup; weapon: EquipmentPiece; expected: number }>();
    setups.forEach((s) => {
      const expected = cache.getSpec(specKey(phase, s.setup)) ?? 0;
      const seen = byWeapon.get(s.weapon.id);
      if (!seen || expected > seen.expected) byWeapon.set(s.weapon.id, { ...s, expected });
    });
    out[key] = rankSpecs([...byWeapon.values()].map((s) => ({
      weaponId: s.weapon.id,
      cost: WEAPON_SPEC_COSTS[s.weapon.name],
      expected: s.expected,
      ticks: calculateAttackSpeed(s.setup.player, phase.monster.monster),
    })));
  }));
  return out;
};
