/**
 * The max-gear setups that new presets start with. Slots follow upstream's own Max Melee / Max Ranged / Void Ranged /
 * Max Mage presets (src/app/components/player/equipment/EquipmentPresets.tsx), plus a weapon. The loadouts are stored
 * as item ids and go through the same import path as a share link, so upstream's item re-resolution applies.
 */
import { generateEmptyPlayer } from '@/state';
import { getMonsters } from '@/lib/Monsters';
import { availableEquipment } from '@/lib/Equipment';
import { getCombatStylesForCategory, PotionMap } from '@/utils';
import { Prayer } from '@/enums/Prayer';
import Potion from '@/enums/Potion';
import { EquipmentCategory } from '@/enums/EquipmentCategory';
import { EquipmentPiece, Player, PlayerEquipment } from '@/types/Player';
import { spells } from '@/types/Spell';
import { IMPORT_VERSION } from '@/types/State';
import { prepareMonster } from '@/bulk/lib/compute';
import { migrateImportable } from '@/bulk/lib/presetIO';
import { BulkSetup } from '@/bulk/types';

type Slots = Partial<Record<keyof PlayerEquipment, number | null>>;

const MAX_MELEE: Slots = {
  head: 26382, cape: 21295, neck: 29801, ammo: 22947, body: 26384, shield: 22322, legs: 26386, hands: 22981, feet: 31097, ring: 28307,
};
const MAX_RANGED: Slots = {
  head: 27235, cape: 28955, neck: 33639, ammo: 33595, body: 27238, legs: 27241, hands: 26235, feet: 31097, ring: 28310,
};
const VOID_RANGED: Slots = {
  head: 11664, cape: 28955, neck: 33639, ammo: 33595, body: 13072, legs: 13073, hands: 8842, feet: 31097, ring: 28310,
};
const MAX_MAGE: Slots = {
  head: 21018, cape: 21791, neck: 12002, ammo: 22947, body: 21021, legs: 21024, hands: 31106, feet: 31097, ring: 28313,
};

const MELEE = { prayer: Prayer.PIETY, potion: Potion.SUPER_COMBAT };
const RANGED = { prayer: Prayer.RIGOUR, potion: Potion.RANGING };
const MAGIC = { prayer: Prayer.AUGURY, potion: Potion.SATURATED_HEART };

interface DefaultSetup {
  name: string;
  slots: Slots;
  style: { name: string; stance?: string };
  prayer: Prayer;
  potion: Potion;
  spell?: string;
  dartId?: number;
}

const harm = (element: string): DefaultSetup => ({
  name: `Max harm ${element.toLowerCase()} surge`,
  slots: { ...MAX_MAGE, weapon: 24423, shield: 27251 },
  style: { name: 'Spell', stance: 'Autocast' },
  spell: `${element} Surge`,
  ...MAGIC,
});

const DEFAULTS: DefaultSetup[] = [
  {
    name: 'Max scythe', slots: { ...MAX_MELEE, weapon: 22325, shield: null }, style: { name: 'Chop' }, ...MELEE,
  },
  {
    name: 'Max scythe inquisitor',
    slots: {
      ...MAX_MELEE, weapon: 22325, shield: null, head: 24419, body: 24420, legs: 24421,
    },
    style: { name: 'Jab' },
    ...MELEE,
  },
  {
    name: 'Max range', slots: { ...MAX_RANGED, weapon: 20997 }, style: { name: 'Rapid' }, ...RANGED,
  },
  {
    name: 'Max range void', slots: { ...VOID_RANGED, weapon: 20997 }, style: { name: 'Rapid' }, ...RANGED,
  },
  {
    name: 'Max range blowpipe', slots: { ...MAX_RANGED, weapon: 12926 }, style: { name: 'Rapid' }, dartId: 11230, ...RANGED,
  },
  {
    name: 'Max range void blowpipe', slots: { ...VOID_RANGED, weapon: 12926 }, style: { name: 'Rapid' }, dartId: 11230, ...RANGED,
  },
  {
    name: 'Max shadow', slots: { ...MAX_MAGE, weapon: 27275 }, style: { name: 'Accurate' }, ...MAGIC,
  },
  {
    name: 'Max ayak', slots: { ...MAX_MAGE, weapon: 31113, shield: 27251 }, style: { name: 'Accurate' }, ...MAGIC,
  },
  harm('Wind'),
  harm('Water'),
  harm('Earth'),
  harm('Fire'),
];

export const DEFAULT_SETUP_NAMES = DEFAULTS.map((d) => d.name);

const toPlayer = (d: DefaultSetup): Player => {
  const player = generateEmptyPlayer(d.name);
  for (const [slot, id] of Object.entries(d.slots)) {
    // only the id is needed: the import below re-resolves the item
    player.equipment[slot as keyof PlayerEquipment] = id === null ? null : ({ id } as EquipmentPiece);
  }

  const weapon = availableEquipment.find((e) => e.id === d.slots.weapon);
  const style = getCombatStylesForCategory((weapon?.category || EquipmentCategory.NONE) as EquipmentCategory)
    .find((s) => s.name === d.style.name && (!d.style.stance || s.stance === d.style.stance));
  if (style) player.style = style;

  player.prayers = [d.prayer];
  player.buffs.potions = [d.potion];
  // imported loadouts keep their boosts as saved, so compute them the way the calculator does
  player.boosts = { ...player.boosts, ...PotionMap[d.potion].calculateFn(player.skills) };
  if (d.spell) player.spell = spells.find((s) => s.name === d.spell) || null;

  if (d.dartId) {
    const dart = availableEquipment.find((e) => e.id === d.dartId);
    (player.equipment.weapon as { itemVars?: object }).itemVars = { blowpipeDartId: d.dartId, blowpipeDartName: dart?.name };
  }
  return player;
};

export const defaultSetups = (): { setups: BulkSetup[]; warnings: string[] } => migrateImportable({
  serializationVersion: IMPORT_VERSION,
  loadouts: DEFAULTS.map(toPlayer),
  selectedLoadout: 0,
  monster: prepareMonster(getMonsters()[0]),
});
