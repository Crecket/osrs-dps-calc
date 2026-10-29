import { describe, expect, test } from '@jest/globals';
import { formatGp, formatTime, parseGp } from '@/raid/lib/format';

describe('format', () => {
  test('parseGp reads k, m and b', () => {
    expect(parseGp('100m')).toBe(100_000_000);
    expect(parseGp('4.5b')).toBe(4_500_000_000);
    expect(parseGp('250k')).toBe(250_000);
    expect(parseGp('1,000,000')).toBe(1_000_000);
    expect(parseGp(' 2 B ')).toBe(2_000_000_000);
    expect(parseGp('lots')).toBeNull();
    expect(parseGp('-5m')).toBeNull();
  });

  test('formatGp shortens', () => {
    expect(formatGp(0)).toBe('0');
    expect(formatGp(950)).toBe('950');
    expect(formatGp(250_000)).toBe('250k');
    expect(formatGp(100_000_000)).toBe('100m');
    expect(formatGp(3_250_000_000)).toBe('3.25b');
  });

  test('formatTime is m:ss', () => {
    expect(formatTime(5.4)).toBe('0:05');
    expect(formatTime(125)).toBe('2:05');
    expect(formatTime(3725)).toBe('62:05');
  });
});
