import { describe, expect, test } from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import { bestPool, WeaponJob, weaponJobs } from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import {
  BestRunDeps, JOBS_PER_WEAPON, referenceGroups, runBestSetup, unionEffects, weaponVariants,
} from '@/best/lib/run';
import { searchWeapon } from '@/best/lib/search';
import { BestPayload, BestResult, handleBestChunk } from '@/best/worker/protocol';
import { computeRow, prepareMonster } from '@/bulk/lib/compute';
import { BulkMonster } from '@/bulk/types';
import {
  BestInputs, BestStyle, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS,
} from '@/best/types';
import { getTestMonster } from '@/tests/utils/TestUtils';
import { spellByName } from '@/types/Spell';

const pool = bestPool();

const inputs = (styles: BestStyle[], topN = 3): BestInputs => ({
  skills: {
    atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
  },
  unlocks: DEFAULT_UNLOCKS,
  conditions: DEFAULT_CONDITIONS,
  potions: {},
  styles,
  topN,
});

const vorkath: BulkMonster = { id: 'vorkath', monster: prepareMonster(getTestMonster('Vorkath', 'Post-quest')) };

// small enough to keep the real search fast
const opts = { topK: 2, cap: 500 };

const twoHanded = (job: WeaponJob) => availableEquipment.find((e) => e.id === job.weaponId)!.isTwoHanded;

/** A cheap made-up DPS per job, so that jobs of one weapon differ too. */
const fakeDps = (job: WeaponJob) => {
  const key = JSON.stringify([job.weaponId, job.combatStyle.name, job.ammoId, job.spellName, job.dartId]);
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) % 100003;
  return 1 + hash / 1000;
};

/** Search answers without the engine: effects by handedness, one fake result per job. */
const synthetic = (p: BestPayload): BestResult => {
  if (p.kind === 'effects') {
    return {
      kind: 'effects', effects: twoHanded(p.jobs[0]) ? { head: [1, 2], neck: [5] } : { head: [2, 3], shield: [9] }, job: p.jobs[0],
    };
  }
  return {
    kind: 'search',
    results: p.jobs.map((job) => ({
      job, gear: {}, dps: fakeDps(job), approximate: p.mode === 'descent',
    })),
  };
};

/** Deps that compute in this thread, recording every search payload. */
const fakeDeps = (handle: (p: BestPayload) => BestResult = handleBestChunk) => {
  const calls: BestPayload[][] = [];
  const answers: BestResult[][] = [];
  let searchCancels = 0;
  const deps: BestRunDeps = {
    search: {
      run: (payloads, onProgress, count = () => 1) => {
        calls.push(payloads);
        const results = payloads.map(handle);
        answers.push(results);
        // like TaskPool: done counts results, one per payload
        onProgress({ results, done: results.length, total: payloads.reduce((n, p) => n + count(p), 0) });
        return Promise.resolve(results);
      },
      cancel: () => { searchCancels += 1; },
    },
    rows: {
      run: (setups, monsters, onProgress) => {
        const rows = setups.flatMap((s) => monsters.map((m) => computeRow(s, m)));
        onProgress({ rows, done: rows.length, total: rows.length });
        return Promise.resolve(rows);
      },
      cancel: () => {},
    },
  };
  return {
    deps, calls, answers, searchCancels: () => searchCancels,
  };
};

describe('referenceGroups', () => {
  test('splits the jobs into one-handed and two-handed ones', () => {
    const jobs = weaponJobs(pool, 'slash');
    const groups = referenceGroups(jobs);
    expect(groups.map((g) => g.map(twoHanded))).toEqual([groups[0].map(() => false), groups[1].map(() => true)]);
    expect(groups.flat().length).toBe(jobs.length);
  });

  test('leaves out the kind that does not exist', () => {
    const groups = referenceGroups(weaponJobs(pool, 'slash').filter(twoHanded));
    expect(groups.length).toBe(1);
    expect(groups[0].every(twoHanded)).toBe(true);
  });
});

describe('unionEffects', () => {
  test('merges per slot without duplicates', () => {
    expect(unionEffects([{ head: [1, 2], neck: [5] }, { head: [2, 3], shield: [9] }])).toEqual({
      head: [1, 2, 3], neck: [5], shield: [9],
    });
  });
});

describe('weaponVariants', () => {
  const scythe = availableEquipment.find((e) => e.name === 'Scythe of Vitur' && e.version === 'Charged')!.id;
  const holy = availableEquipment.find((e) => e.name === 'Holy Scythe of Vitur' && e.version === 'Charged')!.id;
  const sanguine = availableEquipment.find((e) => e.name === 'Sanguine Scythe of Vitur' && e.version === 'Charged')!.id;
  const jobs = weaponJobs(pool, 'slash').filter((j) => [scythe, holy, sanguine].includes(j.weaponId));

  test('weapons with the same stats and the same DPS in every job are variants of the lowest id', () => {
    expect(new Set(jobs.map((j) => j.weaponId)).size).toBe(3);
    const dps = (j: WeaponJob) => (j.combatStyle.name === 'Chop' ? 10 : 8);
    expect(weaponVariants(jobs, dps)).toEqual(new Map([[holy, scythe], [sanguine, scythe]]));
  });

  test('a weapon whose DPS differs in one job is no variant', () => {
    const dps = (j: WeaponJob) => (j.weaponId === holy && j.combatStyle.name === 'Reap' ? 7 : 10);
    expect(weaponVariants(jobs, dps)).toEqual(new Map([[sanguine, scythe]]));
  });

  test('weapons with different stats are never variants', () => {
    const rapier = weaponJobs(pool, 'stab').filter((j) => availableEquipment.find((e) => e.id === j.weaponId)!.name === 'Ghrazi rapier');
    const fang = weaponJobs(pool, 'stab').filter((j) => availableEquipment.find((e) => e.id === j.weaponId)!.name === "Osmumten's fang");
    expect(weaponVariants([...rapier, ...fang], () => 5).size).toBe(0);
  });
});

describe('runBestSetup', () => {
  test('one outcome per style, top setups sorted by computeRow DPS', async () => {
    const { deps } = fakeDeps();
    const progress: [number, number][] = [];
    const outcomes = await runBestSetup(inputs(['slash']), vorkath, deps, (done, total) => progress.push([done, total]), opts);

    expect(outcomes.map((o) => o.style)).toEqual(['slash']);
    const [o] = outcomes;
    expect(o.message).toBeNull();
    expect(o.setups.length).toBeGreaterThan(0);
    // up to topN per weapon, of the topK weapons
    const perWeapon = new Map<number, number>();
    o.setups.forEach((s) => perWeapon.set(s.player.equipment.weapon!.id, (perWeapon.get(s.player.equipment.weapon!.id) ?? 0) + 1));
    expect(perWeapon.size).toBeLessThanOrEqual(2);
    [...perWeapon.values()].forEach((n) => expect(n).toBeLessThanOrEqual(3));
    expect(o.rows.length).toBe(o.setups.length);
    o.setups.forEach((setup, i) => {
      expect(setup.id).toBe(`best-slash-${i}`);
      expect(o.rows[i].setupId).toBe(setup.id);
      expect(o.rows[i].dps).toBe(computeRow(setup, vorkath).dps);
      if (i > 0) expect(o.rows[i].dps).toBeLessThanOrEqual(o.rows[i - 1].dps);
      const { equipment, style } = setup.player;
      // cosmetic variants of the weapon follow its name
      expect(setup.name.startsWith(`${equipment.weapon!.name} (${style.name})`)).toBe(true);
    });
    // every setup is built on the style's base player
    expect(o.setups[0].player.prayers).toEqual(basePlayer(inputs(['slash']), 'slash').prayers);

    const [done, total] = progress[progress.length - 1];
    expect(done).toBe(total);
    expect(progress.every(([d, t]) => d <= t)).toBe(true);
  }, 30000);

  test('effects first, then descent over all jobs, then exhaustive over the top weapons', async () => {
    const { deps, calls } = fakeDeps(synthetic);
    const phases: string[] = [];
    const outcomes = await runBestSetup(inputs(['ranged']), vorkath, deps, (_d, _t, phase) => {
      if (phases[phases.length - 1] !== phase) phases.push(phase);
    }, { topK: 3 });
    const jobs = weaponJobs(pool, 'ranged');
    // progress names its phase
    expect(phases).toEqual(['effects', 'descent', 'exhaustive']);

    expect(calls.length).toBe(3);
    const [effects, descent, exhaustive] = calls;

    // one-handed and two-handed jobs to pick the reference jobs from, their effects merged
    expect(effects.map((p) => (p.kind === 'effects' ? [...new Set(p.jobs.map(twoHanded))] : null))).toEqual([[false], [true]]);
    expect(new Set(effects.flatMap((p) => (p.kind === 'effects' ? p.jobs : [])))).toEqual(new Set(jobs));
    descent.forEach((p) => {
      if (p.kind !== 'search') throw new Error('expected a search payload');
      expect(p.mode).toBe('descent');
      expect(p.effects).toEqual({ head: [2, 3, 1], shield: [9], neck: [5] });
      expect(p.jobs.length).toBeLessThanOrEqual(8);
    });
    expect(descent.flatMap((p) => (p.kind === 'search' ? p.jobs : []))).toEqual(jobs);

    // the top 3 weapons by their best job, and each weapon's top JOBS_PER_WEAPON jobs
    const byWeapon = new Map<number, WeaponJob[]>();
    jobs.forEach((j) => byWeapon.set(j.weaponId, [...(byWeapon.get(j.weaponId) ?? []), j]));
    const best = (ws: WeaponJob[]) => Math.max(...ws.map(fakeDps));
    const expected = [...byWeapon.values()].sort((a, b) => best(b) - best(a)).slice(0, 3)
      .flatMap((ws) => [...ws].sort((a, b) => fakeDps(b) - fakeDps(a)).slice(0, JOBS_PER_WEAPON));
    // the test needs weapons with more jobs than are kept
    expect([...byWeapon.values()].some((ws) => ws.length > JOBS_PER_WEAPON)).toBe(true);

    const exhaustiveJobs = exhaustive.flatMap((p) => {
      if (p.kind !== 'search') throw new Error('expected a search payload');
      expect(p.mode).toBe('exhaustive');
      // each job gets its own full activity test, not the shared effects
      expect(p.effects).toBeUndefined();
      return p.jobs;
    });
    expect(new Set(exhaustiveJobs)).toEqual(new Set(expected));
    expect(exhaustiveJobs.length).toBe(expected.length);
    expect(new Set(exhaustiveJobs.map((j) => j.weaponId)).size).toBe(3);

    // only exhaustive results are shown
    expect(outcomes[0].approximate).toBe(false);
  });

  test('keeps up to topN results of every searched weapon, not just the best weapon\'s', async () => {
    // every exhaustive job answers with four gear variations
    const rings = pool.filter((e) => e.slot === 'ring').slice(0, 4).map((e) => e.id);
    const many = (p: BestPayload): BestResult => {
      const r = synthetic(p);
      if (p.kind !== 'search' || p.mode !== 'exhaustive' || r.kind !== 'search') return r;
      return {
        kind: 'search',
        results: p.jobs.flatMap((job) => [0, 1, 2, 3].map((n) => ({
          job, gear: { ring: rings[n] }, dps: fakeDps(job) - n / 100, approximate: false,
        }))),
      };
    };
    const { deps } = fakeDeps(many);
    const [o] = await runBestSetup(inputs(['ranged'], 2), vorkath, deps, () => {}, { topK: 3 });
    const weapons = o.setups.map((s) => s.player.equipment.weapon!.id);
    expect(new Set(weapons).size).toBe(3);
    [...new Set(weapons)].forEach((w) => expect(weapons.filter((x) => x === w)).toHaveLength(2));
  });

  test('a style with only 0-DPS results has no setups and a message', async () => {
    const zero = (p: BestPayload): BestResult => (p.kind === 'effects'
      ? { kind: 'effects', effects: {}, job: null }
      : {
        kind: 'search',
        results: p.jobs.map((job) => ({
          job, gear: {}, dps: 0, approximate: false,
        })),
      });
    const { deps, calls } = fakeDeps(zero);
    const progress: [number, number][] = [];
    // the fake reports progress for the empty exhaustive phase too, with total 0
    const outcomes = await runBestSetup(inputs(['magic']), vorkath, deps, (done, total) => progress.push([done, total]), opts);

    expect(outcomes).toEqual([{
      style: 'magic', setups: [], rows: [], approximate: false, message: 'No usable magic setup found', variants: {},
    }]);
    // nothing worth an exhaustive search
    expect(calls.flat().some((p) => p.kind === 'search' && p.mode === 'exhaustive')).toBe(false);
    expect(progress.every(([d, t]) => Number.isFinite(d) && d <= t)).toBe(true);
  });

  test('Kurask on task: only leaf-bladed weapons hurt it, and the slash setup still gets a slayer helm or V\'s helm', async () => {
    const kurask: BulkMonster = { id: 'kurask', monster: prepareMonster(getTestMonster('Kurask', 'Normal')) };
    const onTask = { ...inputs(['slash']), conditions: { ...DEFAULT_CONDITIONS, onSlayerTask: true } };
    const { deps, answers } = fakeDeps();
    const [o] = await runBestSetup(onTask, kurask, deps, () => {}, opts);

    // the reference jobs deal damage, so the shared effects aren't all pruned
    answers[0].forEach((r) => {
      if (r.kind !== 'effects') throw new Error('expected an effects result');
      expect(r.job).not.toBeNull();
      expect(Object.values(r.effects).flat().length).toBeGreaterThan(0);
    });
    expect(o.setups.length).toBeGreaterThan(0);
    expect(o.setups[0].player.equipment.weapon!.name).toMatch(/^Leaf-bladed /);
    expect(['Slayer helmet (i)', "V's helm"]).toContain(o.setups[0].player.equipment.head?.name);
  }, 60000);

  test('a T3 vampyre: only vampyrebane weapons hurt it, and effect items are still considered', async () => {
    const vyrewatch: BulkMonster = { id: 'vyrewatch', monster: prepareMonster(getTestMonster('Vyrewatch Sentinel', '1')) };
    const { deps, answers } = fakeDeps();
    const [o] = await runBestSetup(inputs(['crush']), vyrewatch, deps, () => {}, opts);

    const refs = answers[0].map((r) => (r.kind === 'effects' ? r : null));
    expect(refs.some((r) => r !== null && r.job !== null && Object.values(r.effects).flat().length > 0)).toBe(true);
    expect(o.setups.length).toBeGreaterThan(0);
    expect(o.rows[0].dps).toBeGreaterThan(0);
    // Efaritay's aid boosts vampyrebane weapons
    expect(o.setups[0].player.equipment.ring?.name).toBe("Efaritay's aid");
  }, 60000);

  test('a demon on slash: a demonbane sword wins when it beats the strong non-demonbane weapons', async () => {
    const demon = prepareMonster(getTestMonster('Abyssal demon', 'Standard'));
    const { deps } = fakeDeps();
    const [o] = await runBestSetup(inputs(['slash']), { id: 'demon', monster: demon }, deps, () => {}, opts);

    // the best each strong non-demonbane slash weapon can do, over all its jobs
    const base = basePlayer(inputs(['slash']), 'slash');
    const others = ['Scythe of Vitur', 'Blade of Saeldor (c)', 'Soulreaper axe', 'Abyssal tentacle', 'Inquisitor\'s mace']
      .map((name) => availableEquipment.filter((e) => e.name === name).map((e) => e.id))
      .flatMap((ids) => weaponJobs(pool, 'slash').filter((j) => ids.includes(j.weaponId)))
      .flatMap((job) => searchWeapon(base, demon, job, pool, { mode: 'descent', topN: 1, cap: 500 }))
      .map((r) => r.dps);
    expect(others.length).toBeGreaterThan(0);
    expect(o.setups[0].player.equipment.weapon!.name).toMatch(/^(Arclight|Emberlight)$/);
    expect(o.rows[0].dps).toBeGreaterThan(Math.max(...others));
  }, 60000);

  test('cosmetic weapon variants collapse into the lowest id: one exhaustive search, one row, the variants named', async () => {
    const scythes = availableEquipment.filter((e) => /^(Holy |Sanguine )?Scythe of Vitur$/.test(e.name) && e.version === 'Charged').map((e) => e.id);
    expect(scythes).toHaveLength(3);
    const { deps, calls } = fakeDeps();
    const [o] = await runBestSetup(inputs(['slash']), vorkath, deps, () => {}, opts);

    const exhaustive = calls.flat().flatMap((p) => (p.kind === 'search' && p.mode === 'exhaustive' ? p.jobs : []));
    expect(exhaustive.filter((j) => scythes.includes(j.weaponId))).toHaveLength(1);
    const names = o.setups.map((s) => s.player.equipment.weapon!.name);
    expect(names).toContain('Scythe of Vitur');
    expect(names.filter((n) => /Scythe of Vitur/.test(n)).every((n) => n === 'Scythe of Vitur')).toBe(true);
    const setup = o.setups.find((s) => s.player.equipment.weapon!.name === 'Scythe of Vitur')!;
    expect(setup.name).toContain('Holy Scythe of Vitur');
    expect(setup.name).toContain('Sanguine Scythe of Vitur');
    expect(o.variants[setup.player.equipment.weapon!.id]).toEqual(scythes.filter((id) => id !== setup.player.equipment.weapon!.id));
  }, 60000);

  test('excluded items never appear in the results', async () => {
    // every salve, (e), (ei), (i) and plain: otherwise the next salve down takes the neck
    const salves = pool.filter((e) => e.name.startsWith('Salve amulet')).map((e) => e.id);
    expect(salves.length).toBeGreaterThanOrEqual(3);
    const { deps, calls } = fakeDeps();
    const [o] = await runBestSetup({ ...inputs(['slash']), excludedItemIds: salves }, vorkath, deps, () => {}, opts);

    expect(o.setups.length).toBeGreaterThan(0);
    o.setups.forEach((s) => expect(s.player.equipment.neck?.name ?? '').not.toMatch(/^Salve amulet/));
    // the workers get the exclusions with every payload
    calls.flat().forEach((p) => expect(p.excluded).toEqual(salves));
  }, 60000);

  test('a new run cancels the previous one', async () => {
    const { deps, searchCancels } = fakeDeps(synthetic);
    const first = runBestSetup(inputs(['slash'], 1), vorkath, deps, () => {}, opts);
    const second = runBestSetup(inputs(['slash'], 1), vorkath, deps, () => {}, opts);

    await expect(first).rejects.toThrow('cancelled');
    expect(searchCancels()).toBeGreaterThan(0);
    const outcomes = await second;
    // topN 1: one setup for each of the topK weapons
    expect(outcomes[0].setups.length).toBe(2);
  });
});

describe('spellbooks', () => {
  const spellJobs = (calls: BestPayload[][]) => calls.flat().flatMap((p) => p.jobs).filter((j) => j.spellName !== null);

  test('spellbooks [] leaves only powered staves', async () => {
    const { deps, calls } = fakeDeps(synthetic);
    await runBestSetup({ ...inputs(['magic']), spellbooks: [] }, vorkath, deps, () => {}, opts);
    expect(calls.flat().length).toBeGreaterThan(0);
    expect(spellJobs(calls)).toEqual([]);
  });

  test('spellbooks [ancient] leaves only ancient spells', async () => {
    const { deps, calls } = fakeDeps(synthetic);
    await runBestSetup({ ...inputs(['magic']), spellbooks: ['ancient'] }, vorkath, deps, () => {}, opts);
    const jobs = spellJobs(calls);
    expect(jobs.length).toBeGreaterThan(0);
    expect(jobs.every((j) => spellByName(j.spellName!)?.spellbook === 'ancient')).toBe(true);
  });
});

describe('concurrent runs', () => {
  test('two concurrent runs both finish and ask the pools to share workers', async () => {
    const { deps, calls } = fakeDeps(synthetic);
    const runOpts: unknown[] = [];
    const search = deps.search.run;
    deps.search.run = (payloads, onProgress, count, o) => {
      runOpts.push(o);
      return search(payloads, onProgress, count, o);
    };
    const [a, b] = await Promise.all([
      runBestSetup(inputs(['ranged']), vorkath, deps, () => {}, { ...opts, concurrent: true }),
      runBestSetup(inputs(['slash']), vorkath, deps, () => {}, { ...opts, concurrent: true }),
    ]);
    expect(a[0].style).toBe('ranged');
    expect(b[0].style).toBe('slash');
    expect(calls.length).toBeGreaterThan(0);
    expect(runOpts.every((o) => (o as { concurrent?: boolean } | undefined)?.concurrent === true)).toBe(true);
  });
});
