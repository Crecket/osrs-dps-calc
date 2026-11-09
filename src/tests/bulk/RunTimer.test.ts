import { describe, expect, test } from '@jest/globals';
import { remainingMs } from '@/bulk/components/RunTimer';

describe('remainingMs', () => {
  test('says nothing until there is enough to go on', () => {
    expect(remainingMs(1000, 50, 0, 100)).toBeNull();
    expect(remainingMs(10000, 2, 0, 100)).toBeNull();
    expect(remainingMs(10000, 4, 0, 100)).toBeNull();
    expect(remainingMs(10000, 0, 0, 100)).toBeNull();
  });

  test('goes by the pace since the stage started, not what was done before it', () => {
    expect(remainingMs(10000, 50, 0, 100)).toBe(10000);
    expect(remainingMs(10000, 92, 90, 100)).toBeNull();
    expect(remainingMs(10000, 96, 90, 100)).toBeCloseTo(40000 / 6);
  });
});
