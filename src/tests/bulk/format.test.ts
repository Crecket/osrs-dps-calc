import { describe, expect, test } from '@jest/globals';
import { addResultMessage, rowsToCsv, summarizeInputs } from '@/bulk/lib/format';
import { prepareMonster } from '@/bulk/lib/compute';
import { getMonsters } from '@/lib/Monsters';
import { generateEmptyPlayer } from '@/state';
import { BulkRow, BulkSetup } from '@/bulk/types';
import { findEquipment } from '@/tests/utils/TestUtils';

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

    expect(lines[0]).toBe('Setup,head,cape,neck,ammo,weapon,shield,body,legs,hands,feet,ring,Max hit,Accuracy,DPS,TTK,Spec max,Spec acc,Spec dmg,Spec DPS,Error');
    expect(lines[1]).toBe('"Whip, ""fast""",,,,,Abyssal whip,,,,,,,30,0.5,4.25,60,,,,,');
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
