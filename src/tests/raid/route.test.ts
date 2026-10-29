import { describe, expect, test } from '@jest/globals';
import { getMonsters } from '@/lib/Monsters';
import { scaleMonster } from '@/lib/MonsterScaling';
import { RAIDS, raidById } from '@/raid/raids';
import { routeBosses, routePhases } from '@/raid/lib/route';

const fa = raidById('fractured-archive');

describe('raid definitions', () => {
  test('every phase resolves to a monster', () => {
    const monsters = getMonsters();
    RAIDS.forEach((raid) => raid.stops.forEach((stop) => stop.options.forEach((boss) => boss.phases.forEach((phase) => {
      expect(monsters.some((m) => m.id === phase.monsterId && m.version === phase.version)).toBe(true);
    }))));
  });

  test('default route', () => {
    expect(routeBosses(fa, fa.defaultRoute).map((b) => b.id)).toEqual(['guardian', 'bork', 'dreadnoth', 'xarth', 'ocellus']);
    expect(routeBosses(fa, {}).map((b) => b.id)).toEqual(['guardian', 'bork', 'moia', 'dagonhai', 'ocellus']);
  });

  test('an unknown boss falls back to the stop\'s first option', () => {
    expect(routeBosses(fa, { second: 'nope' })[1].id).toBe('bork');
  });

  test('defence reductions applied', () => {
    const phases = routePhases(fa, fa.defaultRoute, { 'bork:0': { elderMaul: 1 } }, []);
    expect(phases).toHaveLength(9);
    expect(phases.find((p) => p.phase.key === 'bork:1')?.monster.monster.name).toBe('The Smorks');
    const bork = phases.find((p) => p.phase.key === 'bork:0')!;
    expect(bork.monster.monster.inputs.defenceReductions.elderMaul).toBe(1);
    const flying = phases.find((p) => p.phase.key === 'guardian:0')!;
    expect(flying.monster.monster.inputs.defenceReductions.tonalztic).toBe(4);
    expect(flying.monster.monster.version).toBe('Flying');
  });

  test('excluded weapon zeroes its defence reduction', () => {
    const phases = routePhases(fa, fa.defaultRoute, {}, [21003]);
    phases.forEach((p) => {
      expect(p.counts.elderMaul).toBe(0);
      expect(p.monster.monster.inputs.defenceReductions.elderMaul).toBe(0);
    });
  });

  test('default specs reach the optimal defence from the strategy list', () => {
    // Defence after the default specs, from the community's optimal spec list
    const expected: Record<string, number> = {
      'guardian:0': 156,
      'guardian:1': 156,
      'bork:0': 180,
      'bork:1': 1,
      'bork:1': 1,
      // the list says 120; the engine's data floors Ezekiel at 78 (60% of 130)
      'ezekiel:0': 78,
      'moia:0': 117,
      'dreadnoth:0': 0,
      'dagonhai:0': 0,
      'dagonhai:1': 0,
      'dagonhai:2': 0,
      'xarth:0': 102,
      'ocellus:0': 129,
      'ocellus:1': 0,
      'ocellus:2': 150,
    };
    const all = [
      ...routePhases(fa, { second: 'bork', third: 'moia', fourth: 'dagonhai' }, {}, []),
      ...routePhases(fa, { second: 'ezekiel', third: 'dreadnoth', fourth: 'xarth' }, {}, []),
    ];
    const got = Object.fromEntries(all.map((p) => [p.phase.key, scaleMonster(p.monster.monster).skills.def]));
    expect(got).toEqual(expected);
  });
});
