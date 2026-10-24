import React, {
  useEffect, useId, useMemo, useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import { StaticImageData } from 'next/image';
import attackIcon from '@/public/img/bonuses/attack.png';
import strengthIcon from '@/public/img/bonuses/strength.png';
import defenceIcon from '@/public/img/bonuses/defence.png';
import rangedIcon from '@/public/img/bonuses/ranged.png';
import magicIcon from '@/public/img/bonuses/magic.png';
import hitpointsIcon from '@/public/img/bonuses/hitpoints.png';
import prayerIcon from '@/public/img/tabs/prayer.png';
import miningIcon from '@/public/img/bonuses/mining.png';
import herbloreIcon from '@/public/img/bonuses/herblore.png';
import { IconX } from '@tabler/icons-react';
import { getCdnImage, PotionMap } from '@/utils';
import { GlobalState, StoreProvider } from '@/state';
import { availableEquipment } from '@/lib/Equipment';
import EquipmentSelect from '@/app/components/player/equipment/EquipmentSelect';
import { bestPool } from '@/best/lib/candidates';
import { EquipmentPiece, PlayerSkills } from '@/types/Player';
import {
  BestStyle, CombatConditions,
} from '@/best/types';
import { useBestStore } from '@/best/state/BestStore';
import {
  allUnlocked, bestPrayers, canUsePrayer, DEFENCE_LEVEL, defaultPotions, PRAYER_LEVEL, prayerChoices, PrayerGroup, stylePrayers,
} from '@/best/lib/loadout';
import { Prayer, PrayerMap } from '@/enums/Prayer';
import { PotionPicker } from '@/bulk/components/FilterBar';
import Panel, { inputClass } from '@/bulk/components/Panel';

/**
 * A whole-number input that only reports values in range, so a half-typed or cleared field doesn't run a search; it
 * shows the stored value again when it loses focus. With `allowEmpty`, a cleared field reports null.
 */
const NumberField: React.FC<{
  label: string;
  value: number | null;
  min: number;
  max: number;
  onChange: (v: number | null) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  icon?: StaticImageData;
}> = ({
  label, value, min, max, onChange, allowEmpty, placeholder, icon,
}) => {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);

  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 text-sm">
      <span className="flex items-center gap-1.5">
        {icon && <img className="w-4 h-4 object-contain" src={icon.src} alt="" />}
        <span>{label}</span>
      </span>
      <input
        id={id}
        type="number"
        className={`${inputClass} w-16`}
        min={min}
        max={max}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === '') {
            if (allowEmpty) onChange(null);
            return;
          }
          const v = Number(e.target.value);
          if (Number.isInteger(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => setText(value === null ? '' : String(value))}
      />
    </label>
  );
};

const Check: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
};

const Section: React.FC<React.PropsWithChildren<{ title: string }>> = ({ title, children }) => (
  <div className="flex flex-col gap-1.5">
    <h3 className="font-serif font-bold text-sm">{title}</h3>
    {children}
  </div>
);

// prayer is set together with the prayer level under Prayers
const SKILLS: [keyof PlayerSkills, string, number, StaticImageData][] = [
  ['atk', 'Attack', 1, attackIcon],
  ['str', 'Strength', 1, strengthIcon],
  ['def', 'Defence', 1, defenceIcon],
  ['ranged', 'Ranged', 1, rangedIcon],
  ['magic', 'Magic', 1, magicIcon],
  ['hp', 'Hitpoints', 10, hitpointsIcon],
  ['mining', 'Mining', 1, miningIcon],
  ['herblore', 'Herblore', 1, herbloreIcon],
];

const CONDITIONS: [keyof Omit<CombatConditions, 'soulreaperStacks' | 'currentHp'>, string][] = [
  ['onSlayerTask', 'On slayer task'],
  ['inWilderness', 'In the Wilderness'],
  ['chargeSpell', 'Charge active'],
  ['markOfDarknessSpell', 'Mark of Darkness active'],
  ['forinthrySurge', 'Forinthry Surge active'],
  ['kandarinDiary', 'Kandarin hard diary'],
];

/** Why the player can't use the prayer, e.g. 'Piety needs 70 Defence'; null when the levels are met. */
const missingLevels = (p: Prayer, prayerLevel: number, defLevel: number): string | null => {
  const needs = [
    ...(prayerLevel < (PRAYER_LEVEL[p] ?? 0) ? [`${PRAYER_LEVEL[p]} Prayer`] : []),
    ...(defLevel < (DEFENCE_LEVEL[p] ?? 0) ? [`${DEFENCE_LEVEL[p]} Defence`] : []),
  ];
  return needs.length > 0 ? `${PrayerMap[p].name} needs ${needs.join(', ')}` : null;
};

const prayerNames = (prayers: Prayer[]) => prayers.map((p) => PrayerMap[p].name).join(' + ');
const choiceValue = (prayers: Prayer[]) => prayers.join(',');

/** The prayer row of one group: Auto (the best usable prayers), every usable choice strongest first, and None. */
const PrayerPicker: React.FC<{ group: PrayerGroup; label: string; style: BestStyle }> = observer(({ group, label, style }) => {
  const store = useBestStore();
  const { skills, prayerOverrides = {} } = store.inputs;
  const unlocks = allUnlocked(store.inputs.unlocks);
  const id = useId();
  const auto = bestPrayers(style, unlocks, skills.def);
  const override = prayerOverrides[group];
  const blocked = override?.find((p) => !canUsePrayer(p, unlocks, skills.def));
  const used = stylePrayers(style, unlocks, skills.def, prayerOverrides);

  const choices = prayerChoices(group, unlocks, skills.def);
  // a saved choice that's usable but not offered (e.g. a weaker pair) stays selectable
  if (override && override.length > 0 && blocked === undefined && !choices.some((c) => choiceValue(c) === choiceValue(override))) choices.push(override);
  let value = 'auto';
  if (override !== undefined && blocked === undefined) value = override.length === 0 ? 'none' : choiceValue(override);

  return (
    <>
      <label htmlFor={id} className="text-sm whitespace-nowrap">{label}</label>
      <div className="flex items-center gap-1.5 min-w-0">
        <span className="flex shrink-0 w-9 gap-0.5">
          {used.map((p) => <img key={p} className="w-4 h-4 object-contain" src={PrayerMap[p].image.src} alt={PrayerMap[p].name} />)}
        </span>
        <select
          id={id}
          className={`${inputClass} w-full min-w-0`}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'auto') store.setPrayerOverride(group, null);
            else if (v === 'none') store.setPrayerOverride(group, []);
            else store.setPrayerOverride(group, v.split(',').map(Number) as Prayer[]);
          }}
        >
          <option value="auto">{`Auto (${auto.length > 0 ? prayerNames(auto) : 'none'})`}</option>
          {choices.map((c) => <option key={choiceValue(c)} value={choiceValue(c)}>{prayerNames(c)}</option>)}
          <option value="none">None</option>
        </select>
      </div>
      {blocked !== undefined && (
        <span className="col-start-2 -mt-1.5 text-xs text-orange-700 dark:text-orange-300">
          {`${missingLevels(blocked, unlocks.prayerLevel, skills.def)} — using Auto`}
        </span>
      )}
    </>
  );
});

export const styleName = (s: BestStyle) => s.charAt(0).toUpperCase() + s.slice(1);

const POTION_GROUPS: { group: 'melee' | 'ranged' | 'magic'; label: string; style: BestStyle }[] = [
  { group: 'melee', label: 'Melee', style: 'slash' },
  { group: 'ranged', label: 'Ranged', style: 'ranged' },
  { group: 'magic', label: 'Magic', style: 'magic' },
];

let poolIds: Set<number> | null = null;
// only items the search could pick are worth excluding
const inPool = (e: EquipmentPiece) => {
  if (!poolIds) poolIds = new Set(bestPool().map((p) => p.id));
  return poolIds.has(e.id);
};

/** Items the search leaves out: chips with a remove button, Clear all, and a search box to exclude more. */
const ExcludedItems: React.FC = observer(() => {
  const store = useBestStore();
  const excluded = store.inputs.excludedItemIds ?? [];
  // upstream's item search reads the monster from a calculator store, so give it a scratch one
  const [scratch] = useState(() => new GlobalState());
  const filter = useMemo(() => inPool, []);
  const items = excluded.map((id) => availableEquipment.find((e) => e.id === id)).filter((e): e is EquipmentPiece => e !== undefined);

  return (
    <Section title="Excluded items">
      {items.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {items.map((item) => (
            <span key={item.id} className="flex items-center gap-1 pl-1 pr-0.5 py-0.5 rounded border border-body-400 dark:border-dark-200 bg-body-100 dark:bg-dark-400 text-xs">
              {item.image && <img className="w-5 h-5 object-contain" src={getCdnImage(`equipment/${item.image}`)} alt="" />}
              {item.name}
              <button
                type="button"
                className="px-1 text-gray-500 dark:text-gray-300 hover:text-orange-500"
                aria-label={`Include ${item.name} again`}
                onClick={() => store.includeItem(item.id)}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
          <button type="button" className="text-xs underline text-gray-500 dark:text-gray-300 hover:text-orange-300" onClick={store.clearExcluded}>
            Clear all
          </button>
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-300">None. Right-click an item in a result to exclude it, or search below.</p>
      )}
      <StoreProvider store={scratch}>
        <EquipmentSelect customAvailableEquipmentFilter={filter} onSelectedItemChange={(item) => item && store.excludeItem(item.equipment.id)} />
      </StoreProvider>
    </Section>
  );
});

/**
 * Everything the search takes besides the monster and the styles: levels, prayers, conditions and potions.
 */
const InputsPanel: React.FC = observer(() => {
  const store = useBestStore();
  const {
    skills, unlocks, conditions, potions,
  } = store.inputs;

  return (
    <Panel title="Your account" className="grow basis-[360px]">
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <Section title="Levels">
          {SKILLS.map(([k, label, min, icon]) => (
            <NumberField key={k} label={label} icon={icon} value={skills[k]} min={min} max={99} onChange={(v) => v !== null && store.setSkills({ [k]: v })} />
          ))}
        </Section>

        <Section title="Prayers">
          <NumberField
            label="Prayer"
            icon={prayerIcon}
            value={unlocks.prayerLevel}
            min={1}
            max={99}
            onChange={(v) => {
              if (v === null) return;
              store.setSkills({ prayer: v });
              store.setUnlocks({ prayerLevel: v });
            }}
          />
          <div className="grid grid-cols-[5rem_1fr] gap-x-3 gap-y-2 items-center">
            {POTION_GROUPS.map(({ group, label, style }) => <PrayerPicker key={group} group={group} label={label} style={style} />)}
          </div>
        </Section>

        <Section title="Conditions">
          {CONDITIONS.map(([k, label]) => (
            <Check key={k} label={label} checked={conditions[k]} onChange={(v) => store.setConditions({ [k]: v })} />
          ))}
          <NumberField
            label="Soulreaper stacks"
            value={conditions.soulreaperStacks}
            min={0}
            max={5}
            onChange={(v) => v !== null && store.setConditions({ soulreaperStacks: v })}
          />
          <NumberField
            label="Current HP"
            // the search treats a current HP above Hitpoints as full HP, so show it that way
            value={conditions.currentHp === null ? null : Math.min(conditions.currentHp, skills.hp)}
            min={1}
            max={skills.hp}
            allowEmpty
            placeholder="max"
            onChange={(v) => store.setConditions({ currentHp: v })}
          />
        </Section>

        <div className="flex flex-col gap-4">
          <Section title="Potions">
            {POTION_GROUPS.map(({ group, label, style }) => (
              <div key={group} className="flex items-center justify-between gap-2 text-sm">
                <span>{label}</span>
                <PotionPicker
                  potions={potions[group] ?? null}
                  onChange={(p) => store.setPotions(group, p)}
                  hint={`${label} setups use these potions`}
                  clearLabel={`Use the default ${label.toLowerCase()} potion`}
                  unsetLabel={(
                    <>
                      {defaultPotions(style).map((p) => (
                        <img key={p} className="w-5 h-5 object-contain" src={PotionMap[p].image.src} alt={PotionMap[p].name} />
                      ))}
                      Default
                    </>
                  )}
                />
              </div>
            ))}
          </Section>
        </div>

        <div className="sm:col-span-2">
          <ExcludedItems />
        </div>
      </div>
    </Panel>
  );
});

export default InputsPanel;
