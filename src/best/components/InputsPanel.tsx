import React from 'react';
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
import slayerIcon from '@/public/img/misc/slayer.webp';
import skullIcon from '@/public/img/misc/skull.webp';
import forinthrySurgeIcon from '@/public/img/misc/forinthry_surge.webp';
import diaryIcon from '@/public/img/misc/diary.png';
import soulreaperIcon from '@/public/img/misc/soulreaper_axe.png';
import chargeIcon from '@/public/img/misc/charge.png';
import markOfDarknessIcon from '@/public/img/misc/mark_of_darkness.png';
import { PotionMap } from '@/utils';
import { PlayerSkills } from '@/types/Player';
import { BestStyle, CombatConditions } from '@/best/types';
import { useAccountEditor } from '@/best/state/AccountEditor';
import { defaultPotions } from '@/best/lib/loadout';
import { PotionPicker } from '@/bulk/components/FilterBar';
import Panel from '@/bulk/components/Panel';
import {
  Check, FieldGrid, FieldLabel, NumberField, Section,
} from '@/best/components/fields';
import PrayerPicker from '@/best/components/PrayerPicker';
import ExcludedItems from '@/best/components/ExcludedItems';

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

// the calculator's icons, and the wiki's spell icons for Charge and Mark of Darkness
// shown in two columns of three, the first ending with Soulreaper stacks and the second with Current HP
const CONDITIONS: [keyof Omit<CombatConditions, 'soulreaperStacks' | 'currentHp'>, string, StaticImageData][] = [
  ['onSlayerTask', 'On slayer task', slayerIcon],
  ['inWilderness', 'In the Wilderness', skullIcon],
  ['kandarinDiary', 'Kandarin hard diary', diaryIcon],
  ['forinthrySurge', 'Forinthry Surge', forinthrySurgeIcon],
  ['chargeSpell', 'Charge', chargeIcon],
  ['markOfDarknessSpell', 'Mark of Darkness', markOfDarknessIcon],
];

// prayers and potions are picked per combat type, in matching rows
const COMBAT_GROUPS: { group: 'melee' | 'ranged' | 'magic'; label: string; style: BestStyle }[] = [
  { group: 'melee', label: 'Melee', style: 'slash' },
  { group: 'ranged', label: 'Ranged', style: 'ranged' },
  { group: 'magic', label: 'Magic', style: 'magic' },
];

const divider = 'border-t border-body-300 dark:border-dark-200 pt-4';

/**
 * The account's levels, prayers, potions and conditions, as grid cells of a two-column grid: every row of the top
 * sections shares one label column, so the controls line up across them. Edits the provided AccountEditor.
 */
export const AccountFields: React.FC = observer(() => {
  const store = useAccountEditor();
  const {
    skills, unlocks, conditions, potions,
  } = store.inputs;

  return (
    <>
      <Section title="Levels">
        <FieldGrid>
          {SKILLS.map(([k, label, min, icon]) => (
            <NumberField key={k} label={label} icon={icon} value={skills[k]} min={min} max={99} onChange={(v) => v !== null && store.setSkills({ [k]: v })} />
          ))}
        </FieldGrid>
      </Section>

      <div className="flex flex-col gap-5 min-w-0">
        <Section title="Prayers">
          <FieldGrid>
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
            {COMBAT_GROUPS.map(({ group, label, style }) => <PrayerPicker key={group} group={group} label={label} style={style} />)}
          </FieldGrid>
        </Section>

        <Section title="Potions">
          <FieldGrid>
            {COMBAT_GROUPS.map(({ group, label, style }) => (
              <React.Fragment key={group}>
                <FieldLabel label={label} />
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
              </React.Fragment>
            ))}
          </FieldGrid>
        </Section>
      </div>

      <Section title="Conditions" className={`sm:col-span-2 ${divider}`}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5">
          {[CONDITIONS.slice(0, 3), CONDITIONS.slice(3)].map((column, i) => (
            <FieldGrid wide key={column[0][0]}>
              {column.map(([k, label, icon]) => (
                <Check key={k} label={label} icon={icon} checked={conditions[k]} onChange={(v) => store.setConditions({ [k]: v })} />
              ))}
              {i === 0 ? (
                <NumberField
                  label="Soulreaper stacks"
                  icon={soulreaperIcon}
                  value={conditions.soulreaperStacks}
                  min={0}
                  max={5}
                  onChange={(v) => v !== null && store.setConditions({ soulreaperStacks: v })}
                />
              ) : (
                <NumberField
                  label="Current HP"
                  icon={hitpointsIcon}
                  // the search treats a current HP above Hitpoints as full HP, so show it that way
                  value={conditions.currentHp === null ? null : Math.min(conditions.currentHp, skills.hp)}
                  min={1}
                  max={skills.hp}
                  allowEmpty
                  placeholder="Max"
                  onChange={(v) => store.setConditions({ currentHp: v })}
                />
              )}
            </FieldGrid>
          ))}
        </div>
      </Section>
    </>
  );
});

/** Everything the search takes besides the monster and the styles: the account fields and the excluded items */
const InputsPanel: React.FC = () => (
  <Panel title="Your account" className="grow basis-[360px] min-w-0">
    <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-5">
      <AccountFields />
      <div className={`sm:col-span-2 ${divider}`}>
        <ExcludedItems />
      </div>
    </div>
  </Panel>
);

export default InputsPanel;
