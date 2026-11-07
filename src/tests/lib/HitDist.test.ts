import { expect, test, describe } from '@jest/globals';
import {
  HitDistribution, Hitsplat, linearMaxTransformer, rerolledMax, WeightedHit,
} from '@/lib/HitDist';

describe('HitDistribution', () => {
  describe('cumulative', () => {
    test('merges hits of the same damage', () => {
      const dist = new HitDistribution([
        new WeightedHit(0.25, [new Hitsplat(0, true)]),
        new WeightedHit(0.25, [new Hitsplat(1, true)]),
        new WeightedHit(0.25, [new Hitsplat(1, true)]),
        new WeightedHit(0.25, [new Hitsplat(2, true)]),
      ]);

      const cumulative = dist.cumulative();
      expect(cumulative.hits).toHaveLength(3);
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.25, [new Hitsplat(0, true)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.5, [new Hitsplat(1, true)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.25, [new Hitsplat(2, true)]));
    });

    test('preserves inaccurate zero hits', () => {
      const dist = new HitDistribution([
        new WeightedHit(0.5, [new Hitsplat(0, false)]),
        new WeightedHit(0.125, [new Hitsplat(0, true)]),
        new WeightedHit(0.125, [new Hitsplat(1, true)]),
        new WeightedHit(0.125, [new Hitsplat(1, true)]),
        new WeightedHit(0.125, [new Hitsplat(2, true)]),
      ]);

      const cumulative = dist.cumulative();
      expect(cumulative.hits).toHaveLength(4);
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.5, [new Hitsplat(0, false)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.125, [new Hitsplat(0, true)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.25, [new Hitsplat(1, true)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.125, [new Hitsplat(2, true)]));
    });

    test('preserves inaccurate non-zero hits', () => {
      const dist = new HitDistribution([
        new WeightedHit(0.5, [new Hitsplat(0, false)]),
        new WeightedHit(0.125, [new Hitsplat(5, false)]),
        new WeightedHit(0.125, [new Hitsplat(5, true)]),
        new WeightedHit(0.125, [new Hitsplat(1, false)]),
        new WeightedHit(0.125, [new Hitsplat(2, true)]),
      ]);

      const cumulative = dist.cumulative();
      expect(cumulative.hits).toHaveLength(5);
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.5, [new Hitsplat(0, false)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.125, [new Hitsplat(5, false)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.125, [new Hitsplat(5, true)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.125, [new Hitsplat(1, false)]));
      expect(cumulative.hits).toContainEqual(new WeightedHit(0.125, [new Hitsplat(2, true)]));
    });
  });
});

describe('rerolledMax', () => {
  const asMap = (d: HitDistribution) => {
    const m = new Map<string, number>();
    d.hits.forEach((h) => {
      const key = h.hitsplats.map((s) => `${s.damage}${s.accurate ? '' : 'x'}`).join(',');
      m.set(key, (m.get(key) ?? 0) + h.probability);
    });
    return m;
  };

  test.each([1, 2, 3])('matches %i linear max transforms of the accurate hits', (times) => {
    // an accuracy roll with a miss, a hit above every reroll, and uneven weights
    const d = HitDistribution.linear(0.6, 0, 40);
    d.addHit(new WeightedHit(0.3, [Hitsplat.INACCURATE]));
    d.addHit(new WeightedHit(0.1, [new Hitsplat(45)]));
    let slow = d;
    for (let i = 0; i < times; i++) slow = slow.transform(linearMaxTransformer(40), { transformInaccurate: false });
    const fast = rerolledMax(d, 40, times)!;
    const [a, b] = [asMap(slow), asMap(fast)];
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort());
    a.forEach((p, key) => expect(b.get(key)).toBeCloseTo(p, 12));
  });

  test('leaves multi-hitsplat hits to the transforms', () => {
    const d = new HitDistribution([new WeightedHit(1, [new Hitsplat(1), new Hitsplat(2)])]);
    expect(rerolledMax(d, 10, 1)).toBeNull();
  });
});
