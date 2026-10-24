/**
 * The best setup worker's messages. This file runs inside the best setup web workers, so it must not import
 * '@/state', React, or anything under src/app. Items travel as ids; the worker resolves them against its own pool.
 */
import { Monster } from '@/types/Monster';
import { EquipmentPiece, Player } from '@/types/Player';
import { bestPool, GearSlot, WeaponJob } from '@/best/lib/candidates';
import {
  referenceJob, searchWeapon, SearchResult, styleEffects,
} from '@/best/lib/search';

/** Effect item ids per slot, as styleEffects finds them. */
export type EffectIds = Partial<Record<GearSlot, number[]>>;

// `excluded`: canonical item ids left out of the worker's pool, as the main thread leaves them out of its own
export type BestPayload =
  // searchWeapon for each job, with the style's shared effects when given
  | { kind: 'search'; base: Player; monster: Monster; jobs: WeaponJob[]; mode: 'descent' | 'exhaustive'; topN: number; cap: number; effects?: EffectIds; excluded?: number[] }
  // styleEffects for the job of `jobs` with the best baseline DPS; no effects when none deals damage
  | { kind: 'effects'; base: Player; monster: Monster; jobs: WeaponJob[]; excluded?: number[] };

export type BestResult =
  | { kind: 'search'; results: SearchResult[] }
  | { kind: 'effects'; effects: EffectIds; job: WeaponJob | null };

// built once per worker; the pool without exclusions is kept for the most recent exclusion list, so that the search's per-pool caches survive between payloads of one run
let fullPool: EquipmentPiece[] | null = null;
let pool: EquipmentPiece[] = [];
let poolKey: string | null = null;
let poolById = new Map<number, EquipmentPiece>();
const getPool = (excluded: number[] = []) => {
  const key = [...excluded].sort((a, b) => a - b).join(',');
  if (key !== poolKey) {
    if (!fullPool) fullPool = bestPool();
    const leftOut = new Set(excluded);
    pool = leftOut.size === 0 ? fullPool : fullPool.filter((e) => !leftOut.has(e.id));
    poolById = new Map(pool.map((e) => [e.id, e]));
    poolKey = key;
  }
  return pool;
};

const toIds = (effects: Partial<Record<GearSlot, EquipmentPiece[]>>): EffectIds => Object.fromEntries(
  Object.entries(effects).map(([slot, items]) => [slot, items!.map((e) => e.id)]),
);

// against the current pool: call getPool first
const fromIds = (ids: EffectIds): Partial<Record<GearSlot, EquipmentPiece[]>> => Object.fromEntries(
  Object.entries(ids).map(([slot, list]) => [slot, list!.map((id) => {
    const item = poolById.get(id);
    if (!item) throw new Error(`Unknown item id ${id}`);
    return item;
  })]),
);

export const handleBestChunk = (p: BestPayload): BestResult => {
  const items = getPool(p.excluded);
  if (p.kind === 'effects') {
    const job = referenceJob(p.base, p.monster, p.jobs, items);
    return { kind: 'effects', effects: job ? toIds(styleEffects(p.base, p.monster, job, items)) : {}, job };
  }
  const effects = p.effects ? fromIds(p.effects) : undefined;
  return {
    kind: 'search',
    results: p.jobs.flatMap((job) => searchWeapon(p.base, p.monster, job, items, {
      mode: p.mode, topN: p.topN, cap: p.cap, effects,
    })),
  };
};
