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
    const phases = routePhases(fa, fa.defaultRoute, { 'bork:0': { elderMaul: 1 } });
    expect(phases).toHaveLength(10);
    expect(phases.find((p) => p.phase.key === 'bork:1')?.monster.monster.name).toBe('The Smorks');
    const bork = phases.find((p) => p.phase.key === 'bork:0')!;
    expect(bork.monster.monster.inputs.defenceReductions.elderMaul).toBe(1);
    const flying = phases.find((p) => p.phase.key === 'guardian:0')!;
    expect(flying.monster.monster.inputs.defenceReductions.tonalztic).toBe(4);
    expect(flying.monster.monster.version).toBe('Flying');
  });

  test('Bork walks with flat armour and is stunned for part of his health bar, when every melee hit lands', () => {
    const phases = routePhases(fa, fa.defaultRoute, {});
    const walking = phases.find((p) => p.phase.key === 'bork:0')!;
    const stunned = phases.find((p) => p.phase.key === 'bork:2')!;
    expect(phases.map((p) => p.phase.key).filter((k) => k.startsWith('bork'))).toEqual(['bork:0', 'bork:2', 'bork:1']);
    expect(walking.monster.monster.skills.hp).toBe(900);
    expect(walking.monster.monster.defensive.flat_armour).toBe(10);
    expect(walking.phase.allowedStyles).toEqual(['ranged']);
    expect(stunned.monster.monster.skills.hp).toBe(600);
    expect(stunned.monster.monster.defensive.flat_armour).toBe(0);
    expect(stunned.monster.monster.skills.def).toBe(0);
    expect(stunned.monster.monster.defensive.crush).toBe(-64);
    expect(stunned.phase.allowedStyles).toEqual(['stab', 'slash', 'crush']);
  });

  test('style rules from the strategy', () => {
    const phase = (key: string) => routePhases(fa, fa.defaultRoute, {}).find((p) => p.phase.key === key)!.phase;
    expect(phase('ocellus:1').allowedStyles).toEqual(['ranged']);
    expect(phase('ocellus:2').parts).toEqual([{ styles: ['ranged'], share: 0.5 }, { styles: ['stab', 'slash', 'crush'], share: 0.5 }]);
    ['dreadnoth:0', 'xarth:0', 'ocellus:0'].forEach((key) => expect(phase(key).parts).toEqual([{ styles: ['ranged'], share: 0.5 }, { share: 0.5 }]));
  });

  test('with the Dragon warhammer instead, its specs take the Elder maul\'s and nothing drains Defence at range', () => {
    const phases = routePhases(fa, fa.defaultRoute, { 'bork:1': { dwh: 1 } }, true);
    phases.forEach((p) => {
      expect(p.counts.elderMaul).toBe(0);
      expect(p.counts.tonalztic).toBe(0);
    });
    const counts = Object.fromEntries(phases.map((p) => [p.phase.key, p.counts.dwh]));
    expect(counts['bork:0']).toBe(2);
    expect(counts['guardian:0']).toBe(0);
    expect(counts['bork:1']).toBe(1);
    expect(phases.find((p) => p.phase.key === 'bork:0')!.monster.monster.inputs.defenceReductions).toMatchObject({ dwh: 2, elderMaul: 0, tonalztic: 0 });
  });

  test('default specs reach the optimal defence from the strategy list', () => {
    // Defence after the default specs, from the community's optimal spec list
    const expected: Record<string, number> = {
      'guardian:0': 156,
      'guardian:1': 156,
      'bork:0': 180,
      // stunned: every hit lands
      'bork:2': 0,
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
      ...routePhases(fa, { second: 'bork', third: 'moia', fourth: 'dagonhai' }, {}),
      ...routePhases(fa, { second: 'ezekiel', third: 'dreadnoth', fourth: 'xarth' }, {}),
    ];
    const got = Object.fromEntries(all.map((p) => [p.phase.key, scaleMonster(p.monster.monster).skills.def]));
    expect(got).toEqual(expected);
  });
});
