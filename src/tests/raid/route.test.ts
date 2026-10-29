import { describe, expect, test } from '@jest/globals';
import { getMonsters } from '@/lib/Monsters';
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
    expect(phases).toHaveLength(8);
    const bork = phases.find((p) => p.phase.key === 'bork:0')!;
    expect(bork.monster.monster.inputs.defenceReductions.elderMaul).toBe(1);
    const flying = phases.find((p) => p.phase.key === 'guardian:0')!;
    expect(flying.monster.monster.inputs.defenceReductions.tonalztic).toBe(1);
    expect(flying.monster.monster.version).toBe('Flying');
  });

  test('excluded weapon zeroes its defence reduction', () => {
    const phases = routePhases(fa, fa.defaultRoute, {}, [21003]);
    phases.forEach((p) => {
      expect(p.counts.elderMaul).toBe(0);
      expect(p.monster.monster.inputs.defenceReductions.elderMaul).toBe(0);
    });
  });
});
