import { describe, expect, test } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { availableEquipment } from '@/lib/Equipment';
import { isEffectItem } from '@/best/lib/effectItems';
import { findEquipment } from '@/tests/utils/TestUtils';

const LIB_DIR = path.join(__dirname, '../../lib');

const listSources = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return listSources(full);
  return entry.name.endsWith('.ts') ? [full] : [];
});

const sources = listSources(LIB_DIR).map((file) => fs.readFileSync(file, 'utf8'));

const literals = new Set<string>();
const substringChecks = new Set<string>();
sources.forEach((src) => {
  for (const m of src.matchAll(/'([^'\n\\]+)'|"([^"\n\\]+)"/g)) literals.add(m[1] ?? m[2]);
  for (const m of src.matchAll(/\.(includes|startsWith|endsWith)\(\s*['"]([^'"]+)['"]/g)) substringChecks.add(m[2]);
});

describe('effectItems', () => {
  test('every equipment name the engine mentions is an effect item', () => {
    const missing = availableEquipment
      .filter((e) => literals.has(e.name) && !isEffectItem(e))
      .map((e) => `${e.name}${e.version ? ` (${e.version})` : ''}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  test('every substring check on names is covered', () => {
    const missing = [...substringChecks].filter((sub) => {
      const containing = availableEquipment.filter((e) => e.name.includes(sub));
      if (containing.length === 0) return false;
      if (containing.some((e) => e.name === sub)) return false;
      return !containing.some((e) => isEffectItem(e));
    });
    expect(missing).toEqual([]);
  });

  test('plain items are not effect items', () => {
    ['Amulet of fury', 'Barrows gloves', 'Dragon boots', 'Primordial boots'].forEach((name) => {
      expect([name, isEffectItem(findEquipment(name))]).toEqual([name, false]);
    });
  });

  test('known effect items are flagged', () => {
    const items = [
      findEquipment('Salve amulet(ei)'),
      findEquipment('Slayer helmet (i)'),
      findEquipment('Void knight top'),
      findEquipment("Inquisitor's great helm"),
      findEquipment('Obsidian helmet'),
      findEquipment('Crystal helm'),
      findEquipment('Blood Moon helm'),
      findEquipment('Arclight'),
      findEquipment('Dragon hunter lance'),
      findEquipment('Keris partisan of breaching'),
      findEquipment('Amulet of avarice'),
    ];
    expect(items.filter((e) => !isEffectItem(e)).map((e) => e.name)).toEqual([]);
  });
});
