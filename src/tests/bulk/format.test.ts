import { describe, expect, test } from '@jest/globals';
import {
  addResultMessage, monsterLabel, rowsToCsv, sortSetups, spellIcon, styleLabel, summarizeInputs, weaponTooltip,
} from '@/bulk/lib/format';
import { prepareMonster } from '@/bulk/lib/compute';
import { getMonsters } from '@/lib/Monsters';
import { generateEmptyPlayer } from '@/state';
import { BulkRow, BulkSetup } from '@/bulk/types';
import { findEquipment } from '@/tests/utils/TestUtils';
import { defaultSetups } from '@/bulk/lib/defaultSetups';

const base = (name: string) => getMonsters().find((m) => m.name === name)!;

describe('summarizeInputs', () => {
  test('default inputs have no summary', () => {
    expect(summarizeInputs(prepareMonster(base('General Graardor')))).toEqual([]);
  });

  test('lists non-default inputs', () => {
    const m = prepareMonster(base('Akkha'), {
      toaInvocationLevel: 300,
      partySize: 3,
      defenceReductions: { dwh: 2, vulnerability: true },
    });

    expect(summarizeInputs(m)).toEqual(['ToA 300', 'Party 3', '2× dwh', 'vulnerability']);
  });

  test('includes the phase for phased monsters', () => {
    const td = getMonsters().find((m) => m.id === 13599)!;
    expect(summarizeInputs(prepareMonster(td, { phase: 'Unshielded' }))).toEqual(['Unshielded']);
  });
});

describe('rowsToCsv', () => {
  test('one line per row with gear names in slot order', () => {
    const player = generateEmptyPlayer('Whip, "fast"');
    player.equipment.weapon = findEquipment('Abyssal whip');
    const setups: BulkSetup[] = [{ id: 's', name: 'Whip, "fast"', player }];
    const rows: BulkRow[] = [{
      setupId: 's', monsterId: 'm', maxHit: 30, accuracy: 0.5, dps: 4.25, ttk: 60, spec: null, issues: [],
    }];

    const lines = rowsToCsv(rows, setups).split('\n');

    expect(lines[0]).toBe('Setup,Style,Prayers,Potions,head,cape,neck,ammo,weapon,shield,body,legs,hands,feet,ring,Max hit,Accuracy,DPS,TTK,Spec max,Spec acc,Spec dmg,Spec DPS,Spec-only DPS,Error');
    expect(lines[1]).toBe('"Whip, ""fast""",Kick,,,,,,,Abyssal whip,,,,,,,30,0.5,4.25,60,,,,,,');
    expect(lines).toHaveLength(2);
  });
});

describe('addResultMessage', () => {
  test('says what was added and what was skipped', () => {
    expect(addResultMessage({ added: 1, skipped: 0 })).toBe('Added 1 setup');
    expect(addResultMessage({ added: 2, skipped: 3 })).toBe('Added 2 setups, 3 were already in this preset');
    expect(addResultMessage({ added: 2, skipped: 1 })).toBe('Added 2 setups, 1 was already in this preset');
    expect(addResultMessage({ added: 0, skipped: 2 })).toBe('Those setups are already in this preset');
  });
});

describe('monsterLabel', () => {
  test('names Challenge Mode, and the summary does not repeat it', () => {
    const vasa = prepareMonster(base('Vasa Nistirio'), { isFromCoxCm: true });

    expect(monsterLabel({ id: 'm', monster: vasa })).toBe('Vasa Nistirio (Normal, Challenge Mode)');
    expect(summarizeInputs(vasa)).not.toContain('CM');
    expect(monsterLabel({ id: 'm', monster: prepareMonster(base('Vasa Nistirio')) })).toBe('Vasa Nistirio (Normal)');
  });
});

describe('styleLabel', () => {
  test('the combat style, or the spell for a magic setup casting one', () => {
    const whip = generateEmptyPlayer();
    whip.equipment.weapon = findEquipment('Abyssal whip');
    whip.style = { name: 'Lash', type: 'slash', stance: 'Controlled' };
    expect(styleLabel(whip)).toBe('Lash');
    expect(weaponTooltip(whip)).toBe('Abyssal whip (Lash, slash)');

    const harm = defaultSetups().setups.find((x) => x.name === 'Max harm fire surge')!.player;
    expect(styleLabel(harm)).toBe('Fire Surge');
    expect(weaponTooltip(harm)).toBe('Harmonised Nightmare staff (Fire Surge)');
  });
});

describe('rowsToCsv prayers and potions', () => {
  test('lists the active prayers and potions by name', () => {
    const scythe = defaultSetups().setups[0];
    const rows: BulkRow[] = [{
      setupId: scythe.id, monsterId: 'm', maxHit: 1, accuracy: 1, dps: 1, ttk: 1, spec: null, issues: [],
    }];

    const line = rowsToCsv(rows, [scythe]).split('\n')[1];

    expect(line.startsWith('Max scythe,Chop,Piety,Super combat,')).toBe(true);
  });
});

describe('spellIcon', () => {
  test("the spell's icon for a magic setup casting one, otherwise none", () => {
    const harm = defaultSetups().setups.find((x) => x.name === 'Max harm fire surge')!.player;
    const scythe = defaultSetups().setups.find((x) => x.name === 'Max scythe')!.player;

    expect(spellIcon(harm)).toContain('Fire');
    expect(spellIcon(harm)).toContain('Surge');
    expect(spellIcon(scythe)).toBeNull();
  });
});

describe('sortSetups', () => {
  test('melee, then ranged, then magic, each by weapon then name', () => {
    const shuffled = [...defaultSetups().setups].reverse();
    const sorted = sortSetups(shuffled);
    // melee (0), ranged (1), magic (2); within each, by weapon then setup name
    const key = (s: (typeof sorted)[number]) => {
      const group = ['ranged', 'magic'].indexOf(s.player.style.type || '') + 1;
      return `${group} ${s.player.equipment.weapon?.name} ${s.name}`;
    };
    const keys = sorted.map(key);

    expect(keys).toEqual([...keys].sort((a, b) => a.localeCompare(b)));
    expect(sorted.slice(0, 2).map((x) => x.name)).toEqual(['Max tentacle', 'Max tentacle bellator']);
    expect(sorted.at(-1)?.name).toBe('Max shadow');
  });

  test('does not change the original order', () => {
    const list = defaultSetups().setups;
    const names = list.map((x) => x.name);
    sortSetups([...list].reverse());
    expect(list.map((x) => x.name)).toEqual(names);
  });
});
