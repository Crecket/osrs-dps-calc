import React, { useEffect, useId, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { PotionMap } from '@/utils';
import { PlayerSkills } from '@/types/Player';
import {
  BEST_STYLES, BestStyle, CombatConditions, PrayerUnlocks,
} from '@/best/types';
import { useBestStore } from '@/best/state/BestStore';
import {
  bestPrayers, canUsePrayer, DEFENCE_LEVEL, defaultPotions, PRAYER_LEVEL, prayerChoices, PrayerGroup, stylePrayers,
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
}> = ({
  label, value, min, max, onChange, allowEmpty, placeholder,
}) => {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);

  return (
    <label htmlFor={id} className="flex items-center justify-between gap-2 text-sm">
      <span>{label}</span>
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
const SKILLS: [keyof PlayerSkills, string, number][] = [
  ['atk', 'Attack', 1],
  ['str', 'Strength', 1],
  ['def', 'Defence', 1],
  ['ranged', 'Ranged', 1],
  ['magic', 'Magic', 1],
  ['hp', 'Hitpoints', 10],
  ['mining', 'Mining', 1],
  ['herblore', 'Herblore', 1],
];

const UNLOCKS: [Exclude<keyof PrayerUnlocks, 'prayerLevel'>, string][] = [
  ['piety', 'Piety / Chivalry'],
  ['rigour', 'Rigour'],
  ['augury', 'Augury'],
  ['deadeye', 'Deadeye'],
  ['mysticVigour', 'Mystic Vigour'],
  ['zeal', 'Zeal'],
];

const CONDITIONS: [keyof Omit<CombatConditions, 'soulreaperStacks' | 'currentHp'>, string][] = [
  ['onSlayerTask', 'On slayer task'],
  ['inWilderness', 'In the Wilderness'],
  ['chargeSpell', 'Charge active'],
  ['markOfDarknessSpell', 'Mark of Darkness active'],
  ['forinthrySurge', 'Forinthry Surge active'],
  ['kandarinDiary', 'Kandarin hard diary'],
];

const UNLOCK_PRAYER: Record<Exclude<keyof PrayerUnlocks, 'prayerLevel'>, Prayer> = {
  piety: Prayer.PIETY,
  rigour: Prayer.RIGOUR,
  augury: Prayer.AUGURY,
  deadeye: Prayer.DEADEYE,
  mysticVigour: Prayer.MYSTIC_VIGOUR,
  zeal: Prayer.ZEAL,
};

/** What the player lacks for the prayer, e.g. 'needs 70 Prayer, 70 Defence'; null when the levels are met. */
const missingLevels = (p: Prayer, prayerLevel: number, defLevel: number): string | null => {
  const prayer = PRAYER_LEVEL[p] ?? 0;
  const defence = DEFENCE_LEVEL[p] ?? 0;
  if (prayerLevel >= prayer && defLevel >= defence) return null;
  return `needs ${prayer} Prayer${defence > 0 ? `, ${defence} Defence` : ''}`;
};

/** Why an unlocked prayer can't be used yet, or null. Piety's unlock covers Chivalry too, which needs less. */
const unlockNote = (k: Exclude<keyof PrayerUnlocks, 'prayerLevel'>, prayerLevel: number, defLevel: number): string | null => {
  if (k !== 'piety') return missingLevels(UNLOCK_PRAYER[k], prayerLevel, defLevel);
  const chivalry = missingLevels(Prayer.CHIVALRY, prayerLevel, defLevel);
  if (chivalry) return `Chivalry ${chivalry}`;
  const piety = missingLevels(Prayer.PIETY, prayerLevel, defLevel);
  return piety && `Piety ${piety}`;
};

const prayerNames = (prayers: Prayer[]) => prayers.map((p) => PrayerMap[p].name).join(' + ');
const choiceValue = (prayers: Prayer[]) => prayers.join(',');

/** The prayer select of one group: Auto (the best usable prayers), every usable choice, and None. */
const PrayerPicker: React.FC<{ group: PrayerGroup; label: string; style: BestStyle }> = observer(({ group, label, style }) => {
  const store = useBestStore();
  const { unlocks, skills, prayerOverrides = {} } = store.inputs;
  const id = useId();
  const auto = bestPrayers(style, unlocks, skills.def);
  const override = prayerOverrides[group];
  const unusable = override !== undefined && !override.every((p) => canUsePrayer(p, unlocks, skills.def));
  const used = stylePrayers(style, unlocks, skills.def, prayerOverrides);

  const choices = prayerChoices(group, unlocks, skills.def);
  // a saved choice that's usable but not offered (e.g. a weaker pair) stays selectable
  if (override && override.length > 0 && !unusable && !choices.some((c) => choiceValue(c) === choiceValue(override))) choices.push(override);
  let value = 'auto';
  if (override !== undefined && !unusable) value = override.length === 0 ? 'none' : choiceValue(override);

  return (
    <div className="flex flex-col gap-0.5 text-sm">
      <label htmlFor={id} className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          {label}
          {used.map((p) => <img key={p} className="w-4 h-4 object-contain" src={PrayerMap[p].image.src} alt={PrayerMap[p].name} />)}
        </span>
        <select
          id={id}
          className={`${inputClass} max-w-[14rem]`}
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'auto') store.setPrayerOverride(group, null);
            else if (v === 'none') store.setPrayerOverride(group, []);
            else store.setPrayerOverride(group, v.split(',').map(Number) as Prayer[]);
          }}
        >
          <option value="auto">{`Auto — ${auto.length > 0 ? prayerNames(auto) : 'none available'}`}</option>
          {choices.map((c) => <option key={choiceValue(c)} value={choiceValue(c)}>{prayerNames(c)}</option>)}
          <option value="none">None</option>
        </select>
      </label>
      {unusable && (
        <span className="text-xs text-orange-700 dark:text-orange-300">{`${prayerNames(override!)} isn't usable at these levels, so Auto is used`}</span>
      )}
    </div>
  );
});

export const styleName = (s: BestStyle) => s.charAt(0).toUpperCase() + s.slice(1);

const POTION_GROUPS: { group: 'melee' | 'ranged' | 'magic'; label: string; style: BestStyle }[] = [
  { group: 'melee', label: 'Melee', style: 'slash' },
  { group: 'ranged', label: 'Ranged', style: 'ranged' },
  { group: 'magic', label: 'Magic', style: 'magic' },
];

const toggleClass = (on: boolean) => `px-2.5 py-1 text-sm ${on
  ? 'bg-orange-400 dark:bg-orange-700 text-white'
  : 'bg-btns-400 dark:bg-dark-500 text-gray-300 line-through'}`;

/**
 * Everything the search takes besides the monster: levels, prayers, conditions, styles and potions.
 */
const InputsPanel: React.FC = observer(() => {
  const store = useBestStore();
  const {
    skills, unlocks, conditions, styles, potions,
  } = store.inputs;

  return (
    <Panel title="Your account" className="grow basis-[360px]">
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
        <Section title="Levels">
          {SKILLS.map(([k, label, min]) => (
            <NumberField key={k} label={label} value={skills[k]} min={min} max={99} onChange={(v) => v !== null && store.setSkills({ [k]: v })} />
          ))}
        </Section>

        <Section title="Prayers">
          <NumberField
            label="Prayer"
            value={unlocks.prayerLevel}
            min={1}
            max={99}
            onChange={(v) => {
              if (v === null) return;
              store.setSkills({ prayer: v });
              store.setUnlocks({ prayerLevel: v });
            }}
          />
          {UNLOCKS.map(([k, label]) => {
            const missing = unlockNote(k, unlocks.prayerLevel, skills.def);
            return (
              <div key={k} className={missing ? 'opacity-60' : ''}>
                <Check label={missing ? `${label} — ${missing}` : label} checked={unlocks[k]} onChange={(v) => store.setUnlocks({ [k]: v })} />
              </div>
            );
          })}
          {POTION_GROUPS.map(({ group, label, style }) => <PrayerPicker key={group} group={group} label={label} style={style} />)}
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
          <Section title="Styles">
            <div className="flex flex-wrap rounded overflow-hidden border border-body-500 dark:border-dark-200 self-start">
              {BEST_STYLES.map((s) => {
                const on = styles.includes(s);
                return (
                  <button
                    key={s}
                    type="button"
                    className={toggleClass(on)}
                    aria-pressed={on}
                    // at least one style stays on
                    disabled={on && styles.length === 1}
                    onClick={() => store.setStyles(on ? styles.filter((x) => x !== s) : BEST_STYLES.filter((x) => x === s || styles.includes(x)))}
                  >
                    {styleName(s)}
                  </button>
                );
              })}
            </div>
          </Section>

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
      </div>
    </Panel>
  );
});

export default InputsPanel;
