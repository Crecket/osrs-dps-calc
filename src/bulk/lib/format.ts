import { MONSTER_PHASES_BY_ID } from '@/lib/constants';
import { Monster } from '@/types/Monster';
import {
  BulkMonster, BulkRow, BulkSetup, GEAR_SLOT_ORDER,
} from '@/bulk/types';

export const monsterLabel = (m: BulkMonster) => `${m.monster.name}${m.monster.version ? ` (${m.monster.version})` : ''}`;

/**
 * Short labels for the monster inputs that differ from the defaults, so it's clear what a preset monster was set up with.
 */
export const summarizeInputs = (m: Monster): string[] => {
  const { inputs } = m;
  const out: string[] = [];

  if (MONSTER_PHASES_BY_ID[m.id] && inputs.phase) out.push(inputs.phase);
  if (inputs.toaInvocationLevel > 0) out.push(`ToA ${inputs.toaInvocationLevel}`);
  if (inputs.toaPathLevel > 0) out.push(`Path ${inputs.toaPathLevel}`);
  if (inputs.isFromCoxCm) out.push('CM');
  if (inputs.partySize > 1) out.push(`Party ${inputs.partySize}`);

  const reductions = Object.entries(inputs.defenceReductions || {});
  for (const [k, v] of reductions) {
    if (typeof v === 'number' && v > 0) out.push(`${v}× ${k}`);
  }
  for (const [k, v] of reductions) {
    if (v === true) out.push(k);
  }

  return out;
};

const csvCell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const rowsToCsv = (rows: BulkRow[], setups: BulkSetup[]): string => {
  const setupsById = new Map(setups.map((s) => [s.id, s]));

  const header = [
    'Setup', ...GEAR_SLOT_ORDER,
    'Max hit', 'Accuracy', 'DPS', 'TTK', 'Spec max', 'Spec acc', 'Spec dmg', 'Spec DPS', 'Error',
  ];
  const lines = rows.map((r) => {
    const setup = setupsById.get(r.setupId);
    return [
      setup?.name,
      ...GEAR_SLOT_ORDER.map((slot) => setup?.player.equipment[slot]?.name),
      r.maxHit, r.accuracy, r.dps, r.ttk,
      r.spec?.maxHit, r.spec?.accuracy, r.spec?.expected, r.spec?.dps,
      r.error,
    ].map(csvCell).join(',');
  });

  return [header.join(','), ...lines].join('\n');
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const addResultMessage = ({ added, skipped }: { added: number; skipped: number }): string => {
  if (added === 0) return 'Those setups are already in this preset';
  if (skipped === 0) return `Added ${plural(added, 'setup')}`;
  return `Added ${plural(added, 'setup')}, ${skipped} ${skipped === 1 ? 'was' : 'were'} already in this preset`;
};
