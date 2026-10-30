import Potion from '@/enums/Potion';
import { Prayer, PrayerMap } from '@/enums/Prayer';
import { PotionMap } from '@/utils';
import {
  AccountInputs, BestInputs, DEFAULT_CONDITIONS, DEFAULT_UNLOCKS,
} from '@/best/types';
import { isPrayerChoice, PRAYER_GROUPS } from '@/best/lib/loadout';

const POTION_GROUPS = ['melee', 'ranged', 'magic'] as const;

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);

/** Keeps the fields of `base` that `raw` has with the same type as the default; nothing else is copied */
const mergeTyped = <T extends object>(base: T, raw: unknown, valid: (k: keyof T, v: unknown) => boolean): T => {
  const out = { ...base };
  if (!isRecord(raw)) return out;
  for (const k of Object.keys(base) as (keyof T)[]) {
    if (k in raw && valid(k, raw[k as string])) out[k] = raw[k as string] as T[keyof T];
  }
  return out;
};

/** Maxed levels, every prayer, default potions and conditions */
export const defaultAccount = (): Required<AccountInputs> => ({
  skills: {
    atk: 99, def: 99, hp: 99, magic: 99, prayer: 99, ranged: 99, str: 99, mining: 99, herblore: 99,
  },
  unlocks: { ...DEFAULT_UNLOCKS },
  conditions: { ...DEFAULT_CONDITIONS },
  potions: {},
  prayerOverrides: {},
});

/** Saved account inputs with defaults for anything missing or invalid */
export const readAccount = (raw: unknown): Required<AccountInputs> => {
  const i = isRecord(raw) ? raw : {};
  const base = defaultAccount();
  const potions: BestInputs['potions'] = {};
  if (isRecord(i.potions)) {
    for (const g of POTION_GROUPS) {
      const p = i.potions[g];
      if (Array.isArray(p)) potions[g] = p.filter((x): x is Potion => typeof x === 'number' && x in PotionMap);
    }
  }

  // only known groups, and only prayer combinations of that group
  const prayerOverrides: BestInputs['prayerOverrides'] = {};
  if (isRecord(i.prayerOverrides)) {
    for (const g of PRAYER_GROUPS) {
      const p = i.prayerOverrides[g];
      if (Array.isArray(p) && p.every((x) => typeof x === 'number' && x in PrayerMap) && isPrayerChoice(g, p as Prayer[])) {
        prayerOverrides[g] = p as Prayer[];
      }
    }
  }

  return {
    skills: mergeTyped(base.skills, i.skills, (_, v) => isNum(v)),
    unlocks: mergeTyped(base.unlocks, i.unlocks, (k, v) => (k === 'prayerLevel' ? isNum(v) : typeof v === 'boolean')),
    conditions: mergeTyped(base.conditions, i.conditions, (k, v) => {
      if (k === 'currentHp') return v === null || isNum(v);
      return k === 'soulreaperStacks' ? isNum(v) : typeof v === 'boolean';
    }),
    potions,
    prayerOverrides,
  };
};
