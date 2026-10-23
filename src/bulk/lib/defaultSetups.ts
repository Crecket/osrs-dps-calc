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

// melee armour: head, body, legs
const TORVA: Slots = { head: 26382, body: 26384, legs: 26386 };
const OATHPLATE: Slots = { head: 30750, body: 30753, legs: 30756 };
const TORVA_OATHPLATE: Slots = { head: 26382, body: 30753, legs: 30756 };
const INQUISITOR: Slots = { head: 24419, body: 24420, legs: 24421 };
const BLOOD_MOON: Slots = { head: 29028, body: 29022, legs: 29025 };
const CRYSTAL: Slots = { head: 23971, body: 23975, legs: 23979 };

interface DefaultSetup {
  name: string;
  slots: Slots;
  style: { name: string; stance?: string };
  prayer: Prayer;
  potion: Potion;
  spell?: string;
  dartId?: number;
  soulreaperStacks?: number;
}

const melee = (name: string, weapon: number, style: string, armour: Slots = TORVA, extra: Partial<DefaultSetup> = {}): DefaultSetup => ({
  name, slots: { ...MAX_MELEE, ...armour, weapon }, style: { name: style }, ...MELEE, ...extra,
});

// a slash weapon in each armour that helps slash: Torva (strength), Oathplate (slash accuracy) and a mix of the two
const slash = (name: string, weapon: number, style: string, extra: Partial<DefaultSetup> = {}): DefaultSetup[] => [
  melee(name, weapon, style, TORVA, extra),
  melee(`${name} oathplate`, weapon, style, OATHPLATE, extra),
  melee(`${name} torva/oathplate`, weapon, style, TORVA_OATHPLATE, extra),
];

const ranged = (name: string, weapon: number, slots: Slots = {}, extra: Partial<DefaultSetup> = {}): DefaultSetup => ({
  name, slots: { ...MAX_RANGED, ...slots, weapon }, style: { name: 'Rapid' }, ...RANGED, ...extra,
});

const harm = (element: string): DefaultSetup => ({
  name: `Max harm ${element.toLowerCase()} surge`,
  slots: { ...MAX_MAGE, weapon: 24423, shield: 27251 },
  style: { name: 'Spell', stance: 'Autocast' },
  spell: `${element} Surge`,
  ...MAGIC,
});

const SCYTHE = 22325;
const SOULREAPER = 28338;
// a full soulreaper axe stack, as at the end of a long fight
const FULL_STACKS = { soulreaperStacks: 5 };

const BASE_DEFAULTS: DefaultSetup[] = [
  ...slash('Max scythe', SCYTHE, 'Chop'),
  melee('Max scythe inquisitor', SCYTHE, 'Jab', INQUISITOR),
  ...slash('Max soulreaper', SOULREAPER, 'Hack', FULL_STACKS),
  melee('Max soulreaper inquisitor', SOULREAPER, 'Smash', INQUISITOR, FULL_STACKS),
  melee('Max inquisitor\'s mace', 24417, 'Pummel', INQUISITOR),
  melee('Max macuahuitl', 28997, 'Pummel'),
  melee('Max macuahuitl inquisitor', 28997, 'Pummel', INQUISITOR),
  melee('Max macuahuitl blood moon', 28997, 'Pummel', BLOOD_MOON),
  melee('Max elder maul inquisitor', 21003, 'Pummel', INQUISITOR),
  melee('Max fang', 26219, 'Lunge'),
  melee('Max rapier', 22324, 'Lunge'),
  melee('Max lance', 22978, 'Lunge'),
  ...slash('Max lance swipe', 22978, 'Swipe'),
  ...slash('Max blade of saeldor', 23995, 'Slash'),
  ...slash('Max noxious halberd', 29796, 'Swipe'),
  ...slash('Max tentacle', 12006, 'Lash'),
  ...slash('Max voidwaker', 27690, 'Slash'),
  ...slash('Max emberlight', 29589, 'Slash'),
  ranged('Max range', 20997),
  ranged('Max range void', 20997, VOID_RANGED),
  ranged('Max range blowpipe', 12926, {}, { dartId: 11230 }),
  ranged('Max range void blowpipe', 12926, VOID_RANGED, { dartId: 11230 }),
  ranged('Max bowfa', 25865, { ammo: null }),
  ranged('Max bowfa crystal', 25865, { ...CRYSTAL, ammo: null }),
  ranged('Max zcb ruby', 26374, { ammo: 21944 }),
  ranged('Max zcb diamond', 26374, { ammo: 21946 }),
  ranged('Max venator', 27610),
  {
    name: 'Max shadow', slots: { ...MAX_MAGE, weapon: 27275 }, style: { name: 'Accurate' }, ...MAGIC,
  },
  {
    name: 'Max sang', slots: { ...MAX_MAGE, weapon: 22323, shield: 27251 }, style: { name: 'Accurate' }, ...MAGIC,
  },
  {
    name: 'Max ayak', slots: { ...MAX_MAGE, weapon: 31113, shield: 27251 }, style: { name: 'Accurate' }, ...MAGIC,
  },
  harm('Wind'),
  harm('Water'),
  harm('Earth'),
  harm('Fire'),
];

const BELLATOR_RING = 28316;

const findStyle = (d: DefaultSetup) => {
  const weapon = availableEquipment.find((e) => e.id === d.slots.weapon);
  return getCombatStylesForCategory((weapon?.category || EquipmentCategory.NONE) as EquipmentCategory)
    .find((s) => s.name === d.style.name && (!d.style.stance || s.stance === d.style.stance));
};

const BLOOD_FURY = 24780;
const SALVE_EI = 12018;

const variant = (d: DefaultSetup, suffix: string, slots: Slots): DefaultSetup => ({
  ...d, name: `${d.name} ${suffix}`, slots: { ...d.slots, ...slots },
});
const isMelee = (d: DefaultSetup) => ['stab', 'slash', 'crush'].includes(findStyle(d)?.type || '');

const DEFAULTS: DefaultSetup[] = BASE_DEFAULTS
  // every slash setup also comes with the Bellator ring (slash accuracy) in place of the Ultor ring (strength)
  .flatMap((d) => (findStyle(d)?.type === 'slash' ? [d, variant(d, 'bellator', { ring: BELLATOR_RING })] : [d]))
  // and every setup with the other necks worth comparing: blood fury for melee, salve (ei) against undead
  .flatMap((d) => [
    d,
    ...(isMelee(d) ? [variant(d, 'blood fury', { neck: BLOOD_FURY })] : []),
    variant(d, 'salve(ei)', { neck: SALVE_EI }),
  ]);

export const DEFAULT_SETUP_NAMES = DEFAULTS.map((d) => d.name);

const toPlayer = (d: DefaultSetup, warnings: string[]): Player => {
  const player = generateEmptyPlayer(d.name);
  for (const [slot, id] of Object.entries(d.slots)) {
    // only the id is needed: the import below re-resolves the item
    player.equipment[slot as keyof PlayerEquipment] = id === null ? null : ({ id } as EquipmentPiece);
  }

  const weapon = availableEquipment.find((e) => e.id === d.slots.weapon);
  if (weapon?.isTwoHanded) player.equipment.shield = null;
  const style = findStyle(d);
  if (style) player.style = style;
  else warnings.push(`${d.name}: no ${d.style.name} style for its weapon`);

  player.prayers = [d.prayer];
  player.buffs.potions = [d.potion];
  // imported loadouts keep their boosts as saved, so compute them the way the calculator does
  player.boosts = { ...player.boosts, ...PotionMap[d.potion].calculateFn(player.skills) };
  if (d.soulreaperStacks) player.buffs.soulreaperStacks = d.soulreaperStacks;
  if (d.spell) player.spell = spells.find((s) => s.name === d.spell) || null;

  if (d.dartId) {
    const dart = availableEquipment.find((e) => e.id === d.dartId);
    (player.equipment.weapon as { itemVars?: object }).itemVars = { blowpipeDartId: d.dartId, blowpipeDartName: dart?.name };
  }
  return player;
};

export const defaultSetups = (): { setups: BulkSetup[]; warnings: string[] } => {
  const styleWarnings: string[] = [];
  const loadouts = DEFAULTS.map((d) => toPlayer(d, styleWarnings));
  const { setups, warnings } = migrateImportable({
    serializationVersion: IMPORT_VERSION,
    loadouts,
    selectedLoadout: 0,
    monster: prepareMonster(getMonsters()[0]),
  });
  return { setups, warnings: [...styleWarnings, ...warnings] };
};
