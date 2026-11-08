/**
 * Golden outputs of the DPS engine and the best setup search, recorded before speed work so it can be checked to give
 * the very same numbers. Thousands of rows (many monsters, every style, weapons with and without effect gear, slayer
 * task on and off, specs) and a set of per-weapon searches.
 *
 * Rewrite the fixture only when an output is meant to change: GOLDEN_WRITE=1 npx jest src/tests/perf/golden.test.ts
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, test } from '@jest/globals';
import {
  bestPool, slotCandidates, WeaponJob, weaponJobs,
} from '@/best/lib/candidates';
import { basePlayer } from '@/best/lib/basePlayer';
import {
  baselineGear, buildPlayer, Gear, searchWeapon,
} from '@/best/lib/search';
import {
  BestInputs, BestStyle, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS,
} from '@/best/types';
import { computeRow, RowPart } from '@/bulk/lib/compute';
import { prepareMonster } from '@/bulk/lib/prepareMonster';
import { BulkMonster, GEAR_SLOT_ORDER } from '@/bulk/types';
import { getTestMonster } from '@/tests/utils/TestUtils';
import { defaultSettings } from '@/raid/lib/runRaid';
import { routePhases } from '@/raid/lib/route';
import { raidById } from '@/raid/raids';

const FIXTURE = path.join(__dirname, 'golden.json');
const WRITE = process.env.GOLDEN_WRITE === '1';
// relative, so a reordered sum's last bits pass but any real change fails
const TOLERANCE = 1e-9;

const STYLES: BestStyle[] = ['stab', 'slash', 'crush', 'ranged', 'magic'];
const JOBS_PER_STYLE = 24;

const inputs = (slayer: boolean): BestInputs => ({
  skills: {
    atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99, farming: 99,
  },
  unlocks: DEFAULT_UNLOCKS,
  conditions: { ...DEFAULT_CONDITIONS, onSlayerTask: slayer },
  potions: {},
  styles: STYLES,
  topN: 1,
});

const MONSTERS: [string, string, boolean][] = [
  ['Abyssal demon', 'Standard', true],
  ['Vorkath', 'Post-quest', false],
  ['Zulrah', 'Serpentine', false],
  ['Corporeal Beast', '', false],
  ['Kalphite Queen', 'Crawling', false],
  ['Tekton', 'Normal', false],
  ['Verzik Vitur', 'Normal mode, Phase 3', false],
  ['General Graardor', '', true],
  ["Kree'arra", '', false],
  ['Sol Heredit', '', false],
  ['Duke Sucellus', 'Post-quest, Awake', false],
  ['Tormented Demon', '1', true],
  ['Akkha', '', false],
  ['Alchemical Hydra', 'Serpentine', true],
  ['Great Olm', 'Head (Normal)', false],
  ['Yama', 'Normal', false],
];

const monsters = (): (BulkMonster & { slayer: boolean })[] => {
  const s = defaultSettings();
  const raid = routePhases(raidById(s.raidId), s.route, s.counts).slice(0, 4)
    .map((p) => ({ ...p.monster, id: `raid-${p.phase.key}`, slayer: false }));
  return [
    ...MONSTERS.map(([name, version, slayer]) => ({
      id: `${name}:${version}`, monster: prepareMonster(getTestMonster(name, version)), slayer,
    })),
    ...raid,
  ];
};

/** Every n-th job, so each style keeps a spread of weapons, stances, ammo and spells */
const spread = (jobs: WeaponJob[], n: number) => (jobs.length <= n ? jobs : Array.from({ length: n }, (_, i) => jobs[Math.floor((i * jobs.length) / n)]));

/** The job's gear three ways: none, the strongest plain items, and effect items (void, slayer helm, salve, ...) */
const gears = (job: WeaponJob, i: number): Gear[] => {
  const pool = bestPool();
  const baseline = baselineGear(pool, job);
  const effects: Gear = { ...baseline };
  GEAR_SLOT_ORDER.forEach((slot, k) => {
    if (slot === 'weapon' || !(slot in baseline)) return;
    const list = slotCandidates(pool, job.style, slot).effect;
    if (list.length) effects[slot] = list[(i + k) % list.length].id;
  });
  return [{}, baseline, effects];
};

type Row = [string, number, number, number, number | null, number | null, number | null];

const rows = (only?: RowPart): Row[] => {
  const pool = bestPool();
  const out: Row[] = [];
  monsters().forEach((m) => {
    STYLES.forEach((style) => {
      const base = basePlayer(inputs(m.slayer), style);
      spread(weaponJobs(pool, style, m.monster), JOBS_PER_STYLE).forEach((job, i) => {
        gears(job, i).forEach((gear, g) => {
          const id = `${m.id}|${style}|${job.weaponId}|${job.combatStyle.name}|${job.ammoId}|${job.spellName}|${job.dartId}|${g}`;
          const row = computeRow({ id, name: id, player: buildPlayer(base, job, gear) }, m, only);
          out.push([id, row.dps, row.maxHit, row.accuracy, row.ttk, row.spec?.expected ?? null, row.spec?.maxHit ?? null]);
        });
      });
    });
  });
  return out;
};

type Search = [string, number, (number | null)[]];

const searches = (): Search[] => {
  const pool = bestPool();
  const out: Search[] = [];
  monsters().filter((_, i) => i % 3 === 0).forEach((m) => {
    STYLES.forEach((style) => {
      const base = basePlayer(inputs(m.slayer), style);
      spread(weaponJobs(pool, style, m.monster), 2).forEach((job) => {
        const [best] = searchWeapon(base, m.monster, job, pool, { mode: 'descent', topN: 1, cap: 500 });
        if (!best) return;
        out.push([`${m.id}|${style}|${job.weaponId}|${job.combatStyle.name}|${job.spellName}`, best.dps,
          GEAR_SLOT_ORDER.filter((s) => s !== 'weapon').map((s) => (best.gear as Record<string, number | null>)[s] ?? null)]);
      });
    });
  });
  return out;
};

const close = (a: number | null, b: number | null) => {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= TOLERANCE * Math.max(1, Math.abs(a), Math.abs(b));
};

describe('golden outputs', () => {
  if (WRITE) {
    test('write the fixture', () => {
      fs.writeFileSync(FIXTURE, JSON.stringify({ rows: rows(), searches: searches() }));
    }, 1_200_000);
    return;
  }
  const golden = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as { rows: Row[]; searches: Search[] };

  test('every row matches', () => {
    const now = rows();
    expect(now.map((r) => r[0])).toEqual(golden.rows.map((r) => r[0]));
    const wrong = now.filter((r, i) => r.slice(1).some((v, k) => !close(v as number | null, golden.rows[i][k + 1] as number | null)))
      .map((r) => ({ now: r, was: golden.rows.find((x) => x[0] === r[0]) }));
    expect(wrong.slice(0, 10)).toEqual([]);
    expect(now.length).toBeGreaterThan(5000);
  }, 1_200_000);

  test('a DPS-only row has the DPS of the full row', () => {
    const now = rows('dps');
    const wrong = now.filter((r, i) => !close(r[1], golden.rows[i][1])).map((r) => ({ now: r, was: golden.rows.find((x) => x[0] === r[0]) }));
    expect(wrong.slice(0, 10)).toEqual([]);
  }, 1_200_000);

  test('every search finds the same setup', () => {
    const now = searches();
    expect(now.map((s) => s[0])).toEqual(golden.searches.map((s) => s[0]));
    const wrong = now.filter((s, i) => !close(s[1], golden.searches[i][1]) || JSON.stringify(s[2]) !== JSON.stringify(golden.searches[i][2]));
    expect(wrong).toEqual([]);
  }, 1_200_000);
});
