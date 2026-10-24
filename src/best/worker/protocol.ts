/**
 * The best setup worker's messages. This file runs inside the best setup web workers, so it must not import
 * '@/state', React, or anything under src/app. Items travel as ids; the worker resolves them against its own pool.
 */
import { Monster } from '@/types/Monster';
import { EquipmentPiece, Player } from '@/types/Player';
import { bestPool, GearSlot, WeaponJob } from '@/best/lib/candidates';
import { searchWeapon, SearchResult, styleEffects } from '@/best/lib/search';

/** Effect item ids per slot, as styleEffects finds them. */
export type EffectIds = Partial<Record<GearSlot, number[]>>;

export type BestPayload =
  // searchWeapon for each job, with the style's shared effects when given
  | { kind: 'search'; base: Player; monster: Monster; jobs: WeaponJob[]; mode: 'descent' | 'exhaustive'; topN: number; cap: number; effects?: EffectIds }
  | { kind: 'effects'; base: Player; monster: Monster; job: WeaponJob };

export type BestResult =
  | { kind: 'search'; results: SearchResult[] }
  | { kind: 'effects'; effects: EffectIds };

// built once per worker
let pool: EquipmentPiece[] | null = null;
let poolById: Map<number, EquipmentPiece> | null = null;
const getPool = () => {
  if (!pool) {
    pool = bestPool();
    poolById = new Map(pool.map((e) => [e.id, e]));
  }
  return pool;
};

const toIds = (effects: Partial<Record<GearSlot, EquipmentPiece[]>>): EffectIds => Object.fromEntries(
  Object.entries(effects).map(([slot, items]) => [slot, items!.map((e) => e.id)]),
);

const fromIds = (ids: EffectIds): Partial<Record<GearSlot, EquipmentPiece[]>> => {
  getPool();
  return Object.fromEntries(Object.entries(ids).map(([slot, list]) => [slot, list!.map((id) => {
    const item = poolById!.get(id);
    if (!item) throw new Error(`Unknown item id ${id}`);
    return item;
  })]));
};

export const handleBestChunk = (p: BestPayload): BestResult => {
  if (p.kind === 'effects') return { kind: 'effects', effects: toIds(styleEffects(p.base, p.monster, p.job, getPool())) };
  const effects = p.effects ? fromIds(p.effects) : undefined;
  return {
    kind: 'search',
    results: p.jobs.flatMap((job) => searchWeapon(p.base, p.monster, job, getPool(), {
      mode: p.mode, topN: p.topN, cap: p.cap, effects,
    })),
  };
};
