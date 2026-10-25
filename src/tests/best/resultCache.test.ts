import { describe, expect, test } from '@jest/globals';
import { hashKey, ResultCache } from '@/best/lib/resultCache';

describe('hashKey', () => {
  test('is stable and short, and tells apart keys that differ by one character', () => {
    const key = JSON.stringify({ inputs: { skills: { atk: 99 } }, monster: { id: 415 } });
    expect(hashKey(key)).toBe(hashKey(key));
    expect(hashKey(key).length).toBeLessThanOrEqual(11);
    expect(hashKey(key)).not.toBe(hashKey(key.replace('99', '98')));
  });
});

describe('ResultCache', () => {
  test('returns what was stored for the same key', () => {
    const cache = new ResultCache<number>();
    cache.set('a', 1);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
  });

  test('keeps the most recently used entries', () => {
    const cache = new ResultCache<number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    // using a makes b the oldest
    cache.get('a');
    cache.set('c', 3);
    expect(cache.size).toBe(2);
    expect(cache.get('a')).toBe(1);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3);
  });
});
