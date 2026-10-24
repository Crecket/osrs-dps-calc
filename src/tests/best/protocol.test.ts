import { describe, expect, test } from '@jest/globals';
import { bestPool, WeaponJob, weaponJobs } from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import { referenceJob, searchWeapon, styleEffects } from '@/best/lib/search';
import { handleBestChunk } from '@/best/worker/protocol';
import { prepareMonster } from '@/bulk/lib/compute';
import {
  BEST_STYLES, BestInputs, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS,
} from '@/best/types';
import { findEquipment, getTestMonster } from '@/tests/utils/TestUtils';

const pool = bestPool();

const inputs: BestInputs = {
  skills: {
    atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
  },
  unlocks: DEFAULT_UNLOCKS,
  conditions: DEFAULT_CONDITIONS,
  potions: {},
  styles: BEST_STYLES,
  topN: 5,
};

const base = basePlayer(inputs, 'slash');
const vorkath = prepareMonster(getTestMonster('Vorkath', 'Post-quest'));
const scytheId = findEquipment('Scythe of Vitur', 'Charged').id;
const scytheJob: WeaponJob = weaponJobs(pool, 'slash').find((j) => j.weaponId === scytheId && j.combatStyle.name === 'Chop')!;

describe('handleBestChunk', () => {
  test('search equals searchWeapon directly', () => {
    const opts = { mode: 'descent' as const, topN: 3, cap: 1000 };
    const res = handleBestChunk({
      kind: 'search', base, monster: vorkath, jobs: [scytheJob], ...opts,
    });

    expect(res.kind).toBe('search');
    const direct = searchWeapon(base, vorkath, scytheJob, pool, opts);
    expect(direct.length).toBeGreaterThan(0);
    expect(res).toEqual({ kind: 'search', results: direct });
  });

  test('search with effect ids equals searchWeapon with the resolved effects', () => {
    const effects = styleEffects(base, vorkath, scytheJob, pool);
    const effectIds = Object.fromEntries(Object.entries(effects).map(([slot, items]) => [slot, items!.map((e) => e.id)]));
    const opts = { mode: 'descent' as const, topN: 3, cap: 1000 };

    const res = handleBestChunk({
      kind: 'search', base, monster: vorkath, jobs: [scytheJob], ...opts, effects: effectIds,
    });

    expect(res).toEqual({ kind: 'search', results: searchWeapon(base, vorkath, scytheJob, pool, { ...opts, effects }) });
  });

  test('effects equals styleEffects of the reference job, mapped to ids', () => {
    const jobs = weaponJobs(pool, 'slash').filter((j) => j.weaponId === scytheId);
    const res = handleBestChunk({
      kind: 'effects', base, monster: vorkath, jobs,
    });

    const job = referenceJob(base, vorkath, jobs, pool)!;
    expect(job.weaponId).toBe(scytheId);
    const effects = styleEffects(base, vorkath, job, pool);
    expect(res).toEqual({
      kind: 'effects',
      effects: Object.fromEntries(Object.entries(effects).map(([slot, items]) => [slot, items!.map((e) => e.id)])),
      job,
    });
  });

  test('effects with no damaging job are empty', () => {
    // melee can't hurt Zulrah
    const zulrah = prepareMonster(getTestMonster('Zulrah', 'Serpentine'));
    const melee = weaponJobs(pool, 'slash').slice(0, 20);
    expect(handleBestChunk({
      kind: 'effects', base, monster: zulrah, jobs: melee,
    })).toEqual({ kind: 'effects', effects: {}, job: null });
  });
});
