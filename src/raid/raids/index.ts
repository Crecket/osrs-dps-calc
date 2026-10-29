import { RaidDef } from '@/raid/types';
import fracturedArchive from '@/raid/raids/fracturedArchive';

export const RAIDS: RaidDef[] = [fracturedArchive];

/** The raid with this id, or the first raid when there is none */
export const raidById = (id: string): RaidDef => RAIDS.find((r) => r.id === id) ?? RAIDS[0];
