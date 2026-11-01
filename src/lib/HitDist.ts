/* eslint max-classes-per-file: 0 */
/* eslint @typescript-eslint/no-use-before-define: 0 */
import {
  max,
  min,
  some,
  sum,
} from 'd3-array';
import { ChartEntry } from '@/types/Charts';

export type HitTransformer = (hitsplat: Hitsplat) => HitDistribution;

export type ProbabilisticDelay = [probability: number, delay: number];
export type WeaponDelayProvider = (wh: WeightedHit) => ProbabilisticDelay[];
export type DelayedHit = [wh: WeightedHit, delay: number];

export type TransformOpts = {
  transformInaccurate: boolean,
};

export const DEFAULT_TRANSFORM_OPTS: TransformOpts = {
  transformInaccurate: true,
};

// the largest damage the array-indexed merge handles; bigger hits take the map
const MAX_INDEXED_DAMAGE = 4096;
const MAX_INDEXED_KEY = MAX_INDEXED_DAMAGE * 2 + 1;

export class Hitsplat {
  /**
   * getHash's key for this hitsplat alone (damage * 2 + accuracy) when it is a whole damage in 0..MAX_INDEXED_DAMAGE,
   * else -1: worked out once, as merges read it for every hit
   */
  public readonly indexKey: number;

  public constructor(
    public readonly damage: number,
    public readonly accurate: boolean = true,
  ) {
    this.indexKey = Number.isInteger(damage) && damage >= 0 && damage <= MAX_INDEXED_DAMAGE ? damage * 2 + (accurate ? 1 : 0) : -1;
  }

  public static INACCURATE: Hitsplat = new Hitsplat(0, false);

  public transform(t: HitTransformer, opts: TransformOpts = DEFAULT_TRANSFORM_OPTS): HitDistribution {
    if (!this.accurate && !opts.transformInaccurate) {
      return new HitDistribution([new WeightedHit(1.0, [this])]);
    }
    return t(this);
  }
}

export class WeightedHit {
  public constructor(
    public readonly probability: number,
    public readonly hitsplats: Hitsplat[],
  ) {}

  public scale(factor: number): WeightedHit {
    // hitsplat lists are never changed after they are made, so the new hit can share this one's
    return new WeightedHit(
      this.probability * factor,
      this.hitsplats,
    );
  }

  public zip(other: WeightedHit): WeightedHit {
    return new WeightedHit(
      this.probability * other.probability,
      [...this.hitsplats, ...other.hitsplats],
    );
  }

  public shift(): [WeightedHit, WeightedHit] {
    return [
      new WeightedHit(this.probability, [this.hitsplats[0]]),
      new WeightedHit(1.0, this.hitsplats.slice(1)),
    ];
  }

  public transform(t: HitTransformer, opts: TransformOpts = DEFAULT_TRANSFORM_OPTS): HitDistribution {
    if (this.hitsplats.length === 1) {
      return this.hitsplats[0].transform(t, opts)
        .scaleProbability(this.probability);
    }

    // recursively zip first hitsplat with remaining hitsplats
    const [head, tail] = this.shift();
    return head.transform(t, opts)
      .zip(tail.transform(t, opts));
  }

  public anyAccurate(): boolean {
    return some(this.hitsplats, (h) => h.accurate);
  }

  private _sum?: number;

  public getSum(): number {
    if (this._sum === undefined) {
      let total = 0;
      for (const h of this.hitsplats) total = addLikeD3(total, h.damage);
      this._sum = total;
    }
    return this._sum;
  }

  public getExpectedValue(): number {
    return this.probability * this.getSum();
  }

  /**
   * The hitsplats packed into one key: 8 bits of damage and 1 accuracy bit each. A plain number whenever the packed
   * value fits in one (nearly always), else a bigint: the same value either way, so hits that shared a key still do,
   * without making a bigint for every hit.
   */
  public getHash(): number | bigint {
    return hashOf(this.hitsplats);
  }

  toString(): string {
    return `WeightedHit(p: ${this.probability}, h: [${this.hitsplats.map((h) => h.damage).join(',')}], s: ${this.getSum()})`;
  }
}

// one-hitsplat lists of an accurate whole damage, shared: hitsplats and their lists never change, and every calc
// starts from a linear distribution of them
const ACCURATE_LISTS: Hitsplat[][] = [];
const accurateList = (damage: number): Hitsplat[] => {
  if (!Number.isInteger(damage) || damage < 0 || damage > MAX_INDEXED_DAMAGE) return [new Hitsplat(damage)];
  let list = ACCURATE_LISTS[damage];
  if (!list) {
    list = [new Hitsplat(damage)];
    ACCURATE_LISTS[damage] = list;
  }
  return list;
};

/** One step of d3's sum, which runs on every hit: zeros and NaN are skipped, the rest added in order */
const addLikeD3 = (total: number, value: number): number => {
  const v = +value;
  return v ? total + v : total;
};

/** WeightedHit.getHash for a list of hitsplats */
export function hashOf(hitsplats: Hitsplat[]): number | bigint {
  if (hitsplats.length === 1) {
    const { damage, accurate } = hitsplats[0];
    if (Number.isSafeInteger(damage) && Math.abs(damage) < 2 ** 50) return damage * 2 + (accurate ? 1 : 0);
  } else {
    let acc = 0;
    let fits = true;
    for (const hitsplat of hitsplats) {
      const { damage } = hitsplat;
      // with damage in 0..255 the bitwise or below is an add; the result must stay an exact number
      if (!Number.isInteger(damage) || damage < 0 || damage > 255 || acc > (Number.MAX_SAFE_INTEGER - 511) / 512) {
        fits = false;
        break;
      }
      acc = (acc * 256 + damage) * 2 + (hitsplat.accurate ? 1 : 0);
    }
    if (fits) return acc;
  }
  let acc = 0n;
  for (const hitsplat of hitsplats) {
    acc <<= 8n;
    acc |= BigInt(hitsplat.damage);
    acc <<= 1n;
    acc |= (hitsplat.accurate ? 1n : 0n);
  }
  // a value a number holds exactly is keyed as that number, like the packed ones above
  return acc >= BigInt(-Number.MAX_SAFE_INTEGER) && acc <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(acc) : acc;
}

export class HitDistribution {
  readonly hits: WeightedHit[];

  constructor(hits: WeightedHit[]) {
    this.hits = hits;
  }

  public addHit(w: WeightedHit): void {
    this.hits.push(w);
  }

  public addHits(w: WeightedHit[]): void {
    this.hits.push(...w);
  }

  public zip(other: HitDistribution): HitDistribution {
    // every pair, this distribution's hits outer, as d3's cross ordered them
    const hits: WeightedHit[] = [];
    for (const a of this.hits) {
      for (const b of other.hits) hits.push(a.zip(b));
    }
    return new HitDistribution(hits);
  }

  public wideTransform(t: HitTransformer, opts: TransformOpts = DEFAULT_TRANSFORM_OPTS): HitDistribution {
    const hits: WeightedHit[] = [];
    for (const h of this.hits) {
      if (h.hitsplats.length === 1) {
        // what h.transform does for one hitsplat, without the in-between distributions: the transformed hits at
        // their probability times h's (in that order, as scaleProbability multiplies)
        const splat = h.hitsplats[0];
        if (!splat.accurate && !opts.transformInaccurate) {
          hits.push(new WeightedHit(1.0 * h.probability, [splat]));
        } else {
          for (const r of t(splat).hits) hits.push(new WeightedHit(r.probability * h.probability, r.hitsplats));
        }
      } else {
        for (const transformed of h.transform(t, opts).hits) hits.push(transformed);
      }
    }
    return new HitDistribution(hits);
  }

  public transform(t: HitTransformer, opts: TransformOpts = DEFAULT_TRANSFORM_OPTS): HitDistribution {
    return transformHits(this.hits, t, opts);
  }

  public scaleProbability(factor: number): HitDistribution {
    return new HitDistribution(this.hits
      .map((h) => h.scale(factor)));
  }

  public scaleDamage(factor: number, divisor: number = 1): HitDistribution {
    return new HitDistribution(this.hits
      .map((h) => new WeightedHit(
        h.probability,
        h.hitsplats.map((s) => new Hitsplat(Math.trunc(s.damage * factor / divisor), s.accurate)),
      )));
  }

  /**
   * Merges the probabilities of hits with identical damage values
   */
  public flatten(): HitDistribution {
    return flattenHits(this.hits);
  }

  /**
     * Converts multi-hits into a single cumulative damage total.
     */
  public cumulative(): HitDistribution {
    const d = new HitDistribution([]);
    const acc = new Map<number, number>();
    for (const hit of this.hits) {
      // if 1 splat is accurate, treat the whole hit as accurate
      // if inaccurate, take the bitwise inverse so that we have a number key that's distinct, we'll undo it later
      const key = hit.anyAccurate() ? hit.getSum() : ~hit.getSum();
      const prev = acc.get(key);
      if (prev === undefined) {
        acc.set(key, hit.probability);
      } else {
        acc.set(key, prev + hit.probability);
      }
    }

    for (const [key, prob] of acc.entries()) {
      const accurate = key >= 0;
      const dmg = accurate ? key : ~key;
      if (prob > 0) {
        d.addHit(new WeightedHit(prob, [new Hitsplat(dmg, accurate)]));
      }
    }

    return d;
  }

  public expectedHit(): number {
    let total = 0;
    for (const h of this.hits) total = addLikeD3(total, h.getExpectedValue());
    return total;
  }

  public size(): number {
    return this.hits.length;
  }

  public getMin(): number {
    return min(this.hits
      .map((h) => h.getSum())) as number;
  }

  public getMax(): number {
    return max(this.hits
      .map((h) => h.getSum())) as number;
  }

  public withProbabilisticDelays(delayProvider: WeaponDelayProvider): DelayedHit[] {
    const hits: ReturnType<HitDistribution['withProbabilisticDelays']> = [];
    this.hits.forEach((wh) => {
      const delays = delayProvider(wh);
      delays.forEach(([probability, delay]) => hits.push([
        new WeightedHit(
          wh.probability * probability,
          [new Hitsplat(wh.getSum(), wh.anyAccurate())],
        ),
        delay,
      ]));
    });

    // dedupe the results and merge entries
    const d: ReturnType<HitDistribution['withProbabilisticDelays']> = [];
    const acc = new Map<number, number>();
    for (const [wh, delay] of hits) {
      const key = (wh.getSum() & 0xFFFFFF) | (delay << 24);
      const prev = acc.get(key);
      if (prev === undefined) {
        acc.set(key, wh.probability);
      } else {
        acc.set(key, prev + wh.probability);
      }
    }

    for (const [key, prob] of acc.entries()) {
      const delay = (key & 0x8F000000) >> 24;
      const dmg = key & 0xFFFFFF;
      d.push([new WeightedHit(prob, [new Hitsplat(dmg, true)]), delay]);
    }

    return d;
  }

  public static linear(accuracy: number, minimum: number, maximum: number): HitDistribution {
    const d = new HitDistribution([]);
    const hitProb = accuracy / (maximum - minimum + 1);
    for (let i = minimum; i <= maximum; i++) {
      d.addHit(new WeightedHit(hitProb, accurateList(i)));
    }
    d.addHit(new WeightedHit(1 - accuracy, [Hitsplat.INACCURATE]));
    return d;
  }

  public static single(accuracy: number, hitsplats: Hitsplat[]): HitDistribution {
    const d = new HitDistribution([
      new WeightedHit(accuracy, hitsplats),
    ]);
    if (accuracy !== 1.0) {
      d.addHit(new WeightedHit(1 - accuracy, [Hitsplat.INACCURATE]));
    }
    return d;
  }
}

/** The key getHash gives a list of one hitsplat when it can index the merge's arrays, else -1 */
const indexKey = (hitsplats: Hitsplat[]): number => (hitsplats.length === 1 ? hitsplats[0].indexKey : -1);

// index buffers, zeroed between uses; a stack, since a transform's own transformer can merge too
const buffers: Int32Array[] = [];

/**
 * Merges hits by getHash, adding the probabilities of equal hits in the order they come and keeping the first-seen
 * order and hitsplat list: what flatten does. Indexes arrays by the single-hitsplat key while every hit has one, and
 * moves to a map (with the same keys, so the same order) on the first hit that doesn't.
 */
class Merger {
  private slotOf: Int32Array | null = buffers.pop() ?? new Int32Array(MAX_INDEXED_KEY + 1);

  private readonly keys: number[] = [];

  private readonly probs: number[] = [];

  private readonly lists: Hitsplat[][] = [];

  private map: Map<number | bigint, { prob: number; hitsplats: Hitsplat[] }> | null = null;

  add(hitsplats: Hitsplat[], probability: number): void {
    if (this.slotOf) {
      const key = indexKey(hitsplats);
      if (key >= 0) {
        const slot = this.slotOf[key];
        if (slot === 0) {
          this.keys.push(key);
          this.probs.push(probability);
          this.lists.push(hitsplats);
          this.slotOf[key] = this.probs.length;
        } else {
          this.probs[slot - 1] += probability;
        }
        return;
      }
      this.toMap();
    }
    const h = hashOf(hitsplats);
    const prev = this.map!.get(h);
    if (prev === undefined) {
      this.map!.set(h, { prob: probability, hitsplats });
    } else {
      prev.prob += probability;
    }
  }

  private release(): void {
    if (!this.slotOf) return;
    for (const key of this.keys) this.slotOf[key] = 0;
    buffers.push(this.slotOf);
    this.slotOf = null;
  }

  private toMap(): void {
    // the indexed keys are getHash's values for those hits, so the map continues in the same order
    this.map = new Map();
    for (let i = 0; i < this.keys.length; i++) this.map.set(this.keys[i], { prob: this.probs[i], hitsplats: this.lists[i] });
    this.release();
  }

  result(): HitDistribution {
    const out: WeightedHit[] = [];
    if (this.map) {
      for (const { prob, hitsplats } of this.map.values()) {
        if (prob > 0) out.push(new WeightedHit(prob, hitsplats));
      }
    } else {
      for (let i = 0; i < this.probs.length; i++) {
        if (this.probs[i] > 0) out.push(new WeightedHit(this.probs[i], this.lists[i]));
      }
      this.release();
    }
    return new HitDistribution(out);
  }
}

function flattenHits(hits: WeightedHit[]): HitDistribution {
  const merger = new Merger();
  for (const hit of hits) merger.add(hit.hitsplats, hit.probability);
  return merger.result();
}

/**
 * wideTransform then flatten, merging each transformed hit as it comes instead of listing them all first: the same
 * hits, probabilities (the transformed hit's times the source hit's) and order of additions.
 */
function transformHits(hits: WeightedHit[], t: HitTransformer, opts: TransformOpts): HitDistribution {
  const merger = new Merger();
  for (const h of hits) {
    if (h.hitsplats.length === 1) {
      const splat = h.hitsplats[0];
      if (!splat.accurate && !opts.transformInaccurate) {
        merger.add(h.hitsplats, 1.0 * h.probability);
      } else {
        for (const r of t(splat).hits) merger.add(r.hitsplats, r.probability * h.probability);
      }
    } else {
      for (const r of h.transform(t, opts).hits) merger.add(r.hitsplats, r.probability);
    }
  }
  return merger.result();
}

export class AttackDistribution {
  readonly dists: HitDistribution[];

  private _zipped?: HitDistribution;

  get zipped(): HitDistribution {
    if (!this._zipped) {
      this._zipped = this.dists.reduce((prev, curr) => prev.zip(curr));
    }
    return this._zipped;
  }

  private _singleHitsplat?: HitDistribution;

  get singleHitsplat(): HitDistribution {
    if (!this._singleHitsplat) {
      this._singleHitsplat = this.dists.reduce((prev, curr) => prev.zip(curr).cumulative());
    }
    return this._singleHitsplat;
  }

  constructor(dists: HitDistribution[]) {
    this.dists = dists;
  }

  public addDist(d: HitDistribution): void {
    this.dists.push(d);
  }

  public transform(t: HitTransformer, opts: TransformOpts = DEFAULT_TRANSFORM_OPTS): AttackDistribution {
    return this.map((d) => d.transform(t, opts));
  }

  public flatten(): AttackDistribution {
    return this.map((d) => d.flatten());
  }

  public scaleProbability(factor: number): AttackDistribution {
    return this.map((d) => d.scaleProbability(factor));
  }

  public scaleDamage(factor: number, divisor: number = 1) {
    return this.map((d) => d.scaleDamage(factor, divisor));
  }

  public getMin(): number {
    return sum(this.dists.map((d) => d.getMin())) || 0;
  }

  public getMax(): number {
    return sum(this.dists.map((d) => d.getMax())) || 0;
  }

  public getExpectedDamage(): number {
    let total = 0;
    for (const d of this.dists) total = addLikeD3(total, d.expectedHit());
    return total || 0;
  }

  public asHistogram(hideMisses: boolean = false): (ChartEntry & { name: string, value: number })[] {
    const dist = this.singleHitsplat;

    const hitMap = new Map<number, number>();
    dist.hits.forEach((h) => {
      if (!hideMisses || h.anyAccurate()) {
        hitMap.set(h.getSum(), (hitMap.get(h.getSum()) || 0) + h.probability);
      }
    });

    const ret: { name: string, value: number }[] = [];
    for (let i = 0; i <= dist.getMax(); i++) {
      const prob = hitMap.get(i);
      if (prob === undefined) {
        ret.push({ name: i.toString(), value: 0 });
      } else {
        ret.push({ name: i.toString(), value: prob });
      }
    }

    return ret;
  }

  public firstHitMax(): AttackDistribution {
    if (this.dists.length === 0) {
      return this;
    }

    const firstDist = this.dists[0];

    const firstMax = max(
      firstDist.hits
        .filter((h) => h.hitsplats[0]?.accurate)
        .map((h) => h.hitsplats[0].damage),
    ) ?? 0;

    const maxedFirstDist = new HitDistribution(
      firstDist.hits.map((h) => {
        if (!h.hitsplats[0]?.accurate) {
          return h;
        }

        return new WeightedHit(
          h.probability,
          [
            new Hitsplat(firstMax, true),
            ...h.hitsplats.slice(1),
          ],
        );
      }),
    ).flatten();

    return new AttackDistribution([
      maxedFirstDist,
      ...this.dists.slice(1),
    ]);
  }

  public firstHitAccurate(): AttackDistribution {
    if (this.dists.length === 0) {
      return this;
    }

    const firstDist = this.dists[0];

    const accurateFirstDist = new HitDistribution(
      firstDist.hits
        .filter((h) => h.hitsplats[0]?.accurate)
        .map((h) => new WeightedHit(
          h.probability,
          [...h.hitsplats],
        )),
    );

    const totalProbability = sum(
      accurateFirstDist.hits,
      (h) => h.probability,
    );

    return new AttackDistribution([
      accurateFirstDist.scaleProbability(1 / totalProbability),
      ...this.dists.slice(1),
    ]);
  }

  public firstHitMinimum(minimum: number): AttackDistribution {
    if (this.dists.length === 0) {
      return this;
    }

    const newFirstDist = this.dists[0].transform(
      (h) => HitDistribution.single(
        1.0,
        [new Hitsplat(Math.max(h.damage, minimum), h.accurate)],
      ),
      { transformInaccurate: false },
    );

    return new AttackDistribution([
      newFirstDist,
      ...this.dists.slice(1),
    ]).flatten();
  }

  private map(m: (d: HitDistribution) => HitDistribution) {
    return new AttackDistribution(
      this.dists.map(m),
    );
  }
}

export function flatLimitTransformer(maximum: number, minimum: number = 0): HitTransformer {
  return (h) => new HitDistribution(
    [new WeightedHit(1.0, [new Hitsplat(Math.max(minimum, Math.min(h.damage, maximum)), h.accurate)])],
  );
}

export function linearMinTransformer(maximum: number, offset: number = 0): HitTransformer {
  return (h) => {
    const d = new HitDistribution([]);
    const prob = 1.0 / (maximum + 1);
    for (let i = 0; i <= maximum; i++) {
      d.addHit(new WeightedHit(
        prob,
        [new Hitsplat(Math.min(h.damage, i + offset), h.accurate)],
      ));
    }
    return d.flatten();
  };
}

export function linearMaxTransformer(maximum: number, offset: number = 0): HitTransformer {
  return (h) => {
    const d = new HitDistribution([]);
    const prob = 1.0 / (maximum + 1);
    for (let i = 0; i <= maximum; i++) {
      d.addHit(new WeightedHit(
        prob,
        [new Hitsplat(Math.max(h.damage, i + offset), h.accurate)],
      ));
    }
    return d.flatten();
  };
}

export function cappedRerollTransformer(limit: number, rollMax: number, offset: number = 0): HitTransformer {
  return (h) => {
    if (h.damage <= limit) {
      return new HitDistribution([new WeightedHit(1.0, [h])]);
    }

    const d = new HitDistribution([]);
    const prob = 1.0 / (rollMax + 1);
    for (let i = 0; i <= rollMax; i++) {
      d.addHit(new WeightedHit(
        prob,
        [new Hitsplat(h.damage > limit ? i + offset : h.damage, h.accurate)],
      ));
    }
    return d.flatten();
  };
}

export function multiplyTransformer(numerator: number, divisor: number = 1, minimum: number = 0): HitTransformer {
  return (h) => {
    let dmg = Math.trunc(numerator * h.damage / divisor);
    if (minimum !== 0) {
      if (h.damage >= minimum) {
        // if the value started above the minimum, make sure it doesn't drop below
        dmg = Math.max(minimum, dmg);
      } else {
        // if the value started below the minimum, make sure it isn't reduced, but respect increases
        dmg = Math.max(h.damage, dmg);
      }
    }
    return new HitDistribution(
      [new WeightedHit(1.0, [new Hitsplat(dmg, h.accurate)])],
    );
  };
}

export function divisionTransformer(divisor: number, minimum: number = 0): HitTransformer {
  return multiplyTransformer(1, divisor, minimum);
}

export function flatAddTransformer(addend: number, minimum: number = 0): HitTransformer {
  return (h) => new HitDistribution([
    new WeightedHit(1.0, [new Hitsplat(Math.max(minimum, h.damage + addend), h.accurate)]),
  ]);
}
