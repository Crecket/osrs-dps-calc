import { MONSTER_PHASES_BY_ID } from '@/lib/constants';
import { Monster } from '@/types/Monster';
import { Player } from '@/types/Player';
import { PrayerMap } from '@/enums/Prayer';
import { getWikiImage, PotionMap } from '@/utils';
import {
  BulkMonster, BulkRow, BulkSetup, GEAR_SLOT_ORDER,
} from '@/bulk/types';

export const monsterLabel = (m: BulkMonster) => {
  const parts = [m.monster.version, m.monster.inputs?.isFromCoxCm ? 'Challenge Mode' : ''].filter(Boolean);
  return `${m.monster.name}${parts.length > 0 ? ` (${parts.join(', ')})` : ''}`;
};

/**
 * Short labels for the monster inputs that differ from the defaults, so it's clear what a preset monster was set up with.
 */
export const summarizeInputs = (m: Monster): string[] => {
  const { inputs } = m;
  const out: string[] = [];

  if (MONSTER_PHASES_BY_ID[m.id] && inputs.phase) out.push(inputs.phase);
  if (inputs.toaInvocationLevel > 0) out.push(`ToA ${inputs.toaInvocationLevel}`);
  if (inputs.toaPathLevel > 0) out.push(`Path ${inputs.toaPathLevel}`);
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

// the spell for a magic setup that casts one, otherwise the combat style
export const styleLabel = (player: Player): string => (player.style.type === 'magic' && player.spell
  ? player.spell.name
  : player.style.name);

const TYPE_ORDER: Record<string, number> = { ranged: 1, magic: 2 };

/**
 * Setups for display: melee, then ranged, then magic (by the attack style's type), each by weapon name, then name.
 */
export const sortSetups = (setups: BulkSetup[]): BulkSetup[] => [...setups].sort((a, b) => {
  const type = (s: BulkSetup) => TYPE_ORDER[s.player.style.type ?? ''] ?? 0;
  const weapon = (s: BulkSetup) => s.player.equipment.weapon?.name ?? '';
  return type(a) - type(b) || weapon(a).localeCompare(weapon(b)) || a.name.localeCompare(b.name);
});

export const spellIcon = (player: Player): string | null => (player.style.type === 'magic' && player.spell?.image
  ? getWikiImage(player.spell.image)
  : null);

export const weaponTooltip = (player: Player): string => {
  const weapon = player.equipment.weapon?.name || 'No weapon';
  if (player.style.type === 'magic' && player.spell) return `${weapon} (${player.spell.name})`;
  return `${weapon} (${player.style.name}, ${player.style.type})`;
};

const csvCell = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export const rowsToCsv = (rows: BulkRow[], setups: BulkSetup[]): string => {
  const setupsById = new Map(setups.map((s) => [s.id, s]));

  const header = [
    'Setup', 'Style', 'Prayers', 'Potions', ...GEAR_SLOT_ORDER,
    'Max hit', 'Accuracy', 'DPS', 'TTK', 'Spec max', 'Spec acc', 'Spec dmg', 'Spec DPS', 'Spec-only DPS', 'Error',
  ];
  const lines = rows.map((r) => {
    const setup = setupsById.get(r.setupId);
    return [
      setup?.name,
      setup ? styleLabel(setup.player) : '',
      setup?.player.prayers.map((p) => PrayerMap[p].name).join(' + '),
      setup?.player.buffs.potions.map((p) => PotionMap[p].name).join(' + '),
      ...GEAR_SLOT_ORDER.map((slot) => setup?.player.equipment[slot]?.name),
      r.maxHit, r.accuracy, r.dps, r.ttk,
      r.spec?.maxHit, r.spec?.accuracy, r.spec?.expected, r.spec?.dps, r.spec?.regenDps,
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
