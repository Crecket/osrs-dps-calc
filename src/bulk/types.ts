import { Player, PlayerEquipment } from '@/types/Player';
import { Monster } from '@/types/Monster';

export interface BulkSetup {
  id: string;
  name: string;
  player: Player;
}

/**
 * A monster entry in a preset. The full monster object is kept (including its inputs) so that raid levels, phases,
 * defence reductions and custom monsters survive.
 */
export interface BulkMonster {
  id: string;
  monster: Monster;
}

export interface BulkPreset {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  // upstream IMPORT_VERSION at save time, so that upstream's migrations can be applied on load
  serializationVersion: number;
  setups: BulkSetup[];
  // the one monster every setup is compared against; null until one is picked
  monster: BulkMonster | null;
}

/**
 * Presets saved or exported before one-monster presets had a list of monsters.
 */
export type LegacyBulkPreset = Omit<BulkPreset, 'monster'> & { monsters: BulkMonster[] };

export interface BulkSpecResult {
  maxHit: number;
  accuracy: number;
  expected: number;
  dps: number;
  partial: boolean;
}

export interface BulkRow {
  setupId: string;
  monsterId: string;
  maxHit: number;
  accuracy: number;
  dps: number;
  // null when the setup can never kill the monster (including when it can't deal damage)
  ttk: number | null;
  spec: BulkSpecResult | null;
  issues: string[];
  error?: string;
}

export const GEAR_SLOT_ORDER: (keyof PlayerEquipment)[] = [
  'head', 'cape', 'neck', 'ammo', 'weapon', 'shield', 'body', 'legs', 'hands', 'feet', 'ring',
];
