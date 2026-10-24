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

const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const sources = listSources(LIB_DIR).map((file) => stripComments(fs.readFileSync(file, 'utf8')));

const unescape = (lit: string) => lit.replace(/\\(.)/g, '$1');

// Note: checks built from template strings or variables (e.g. includes(spellClass) in PlayerVsNPCCalc.ts) are not
// visible to this extraction.
const literals = new Set<string>();
const substringChecks = new Set<string>();
sources.forEach((src) => {
  for (const m of src.matchAll(/'((?:[^'\n\\]|\\.)+)'|"((?:[^"\n\\]|\\.)+)"/g)) literals.add(unescape(m[1] ?? m[2]).toLowerCase());
  for (const m of src.matchAll(/\.(includes|startsWith|endsWith)\(\s*(?:'((?:[^'\n\\]|\\.)+)'|"((?:[^"\n\\]|\\.)+)")/g)) substringChecks.add(unescape(m[2] ?? m[3]));
});

// Generic words the engine only applies to the ammo slot; "Barrows gloves" or "Crate of arrowtips" are not ammo.
const AMMO_SLOT_ONLY = new Set(['arrow', 'bolt']);

describe('effectItems', () => {
  test('every equipment name the engine mentions is an effect item', () => {
    const missing = availableEquipment
      .filter((e) => literals.has(e.name.toLowerCase()) && !isEffectItem(e))
      .map((e) => `${e.name}${e.version ? ` (${e.version})` : ''}`);
    expect([...new Set(missing)]).toEqual([]);
  });

  test('every substring check on names is covered', () => {
    const missing = [...substringChecks]
      .flatMap((sub) => availableEquipment
        .filter((e) => e.name.toLowerCase().includes(sub.toLowerCase()) && (!AMMO_SLOT_ONLY.has(sub) || e.slot === 'ammo') && !isEffectItem(e))
        .map((e) => `${sub}: ${e.name}${e.version ? ` (${e.version})` : ''}`));
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
