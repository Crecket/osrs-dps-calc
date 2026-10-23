import { describe, expect, test } from '@jest/globals';
import { getCdnImage } from '@/utils';

describe('getCdnImage', () => {
  test('encodes a % in a file name, so the URL is valid', () => {
    expect(getCdnImage('monsters/The Maiden of Sugadinti (70% health).png'))
      .toBe('https://tools.runescape.wiki/osrs-dps/cdn/monsters/The%20Maiden%20of%20Sugadinti%20(70%25%20health).png');
  });

  test('keeps the folder separators', () => {
    expect(getCdnImage('equipment/Abyssal whip.png')).toBe('https://tools.runescape.wiki/osrs-dps/cdn/equipment/Abyssal%20whip.png');
  });
});
