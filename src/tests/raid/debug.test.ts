import { describe, expect, test } from '@jest/globals';
import { availableEquipment } from '@/lib/Equipment';
import { getCombatStylesForCategory } from '@/utils';
import { buildPlayer } from '@/best/lib/search';
import { basePlayer } from '@/best/lib/basePlayer';
import { defaultSettings, raidBaseInputs, RaidResult } from '@/raid/lib/runRaid';
import { layoutLoadout } from '@/raid/lib/layout';
import { debugReport } from '@/raid/lib/debug';

const tbow = availableEquipment.find((e) => e.id === 20997)!;
const rapid = getCombatStylesForCategory(tbow.category).find((s) => s.stance === 'Rapid')!;

describe('debugReport', () => {
  test('names every item and keeps the numbers, without the full player objects', () => {
    const settings = defaultSettings();
    const player = buildPlayer(basePlayer(raidBaseInputs(settings), 'ranged'), {
      style: 'ranged', weaponId: 20997, combatStyle: rapid, ammoId: 11212, spellName: null, dartId: null,
    }, { head: 27235 });
    const candidate = {
      phaseKey: 'bork:0', style: 'ranged' as const, dps: 10, itemIds: [20997, 11212, 27235], setup: { id: 'x', name: 'Twisted bow', player },
    };
    const result: RaidResult = {
      plan: {
        itemIds: [20997, 11212, 27235],
        cost: 1e9,
        totalSeconds: 150,
        overBudget: false,
        main: candidate,
        picks: [{
          key: 'bork:0', hp: 1500, candidate, seconds: 150,
        }],
      },
      layout: layoutLoadout([20997, 11212, 27235], candidate.setup, settings.supplies, settings.magic),
      phases: [{
        key: 'bork:0', label: 'Bork', bossId: 'bork', bossName: 'Bork', hp: 1500, counts: { elderMaul: 0, dwh: 0, tonalztic: 0 },
      }],
      options: { 'bork:0': [{ weaponId: 20997, dps: 10, seconds: 150 }] },
      specs: {},
      tiers: {
        'bork:0': [{
          weaponId: 20997, style: 'ranged', dps: 10, seconds: 150, cost: 1e9, held: true,
        }],
      },
    };
    const report = debugReport(settings, result) as {
      picks: { phase: string; weapon: string; gear: Record<string, string> }[];
      items: string[];
      tiers: Record<string, { weapon: string }[]>;
      worn: Record<string, string>;
    };
    expect(report.picks[0]).toMatchObject({
      phase: 'bork:0', weapon: 'Twisted bow', style: 'ranged', dps: 10,
    });
    expect(report.picks[0].gear.head).toBe('Masori mask (f)');
    expect(report.items).toContain('Twisted bow');
    expect(report.worn.weapon).toBe('Twisted bow');
    expect(report.tiers['bork:0'][0].weapon).toBe('Twisted bow');
    expect(JSON.stringify(report)).not.toContain('"equipment"');
  });
});
