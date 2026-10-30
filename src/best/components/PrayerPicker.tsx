import React, { useId } from 'react';
import { observer } from 'mobx-react-lite';
import { BestStyle } from '@/best/types';
import { useAccountEditor } from '@/best/state/AccountEditor';
import {
  allUnlocked, bestPrayers, canUsePrayer, DEFENCE_LEVEL, PRAYER_LEVEL, prayerChoices, PrayerGroup, stylePrayers,
} from '@/best/lib/loadout';
import { Prayer, PrayerMap } from '@/enums/Prayer';
import { fieldClass, FieldLabel } from '@/best/components/fields';

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

/**
 * One group's prayer row in a FieldGrid: Auto (the best usable prayers), every usable choice strongest first, and None,
 * with the icons of the prayers in use beside it.
 */
const PrayerPicker: React.FC<{ group: PrayerGroup; label: string; style: BestStyle }> = observer(({ group, label, style }) => {
  const store = useAccountEditor();
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
      <FieldLabel htmlFor={id} label={label} />
      <div className="flex items-center gap-2 min-w-0">
        <select
          id={id}
          className={`${fieldClass} w-full min-w-0 cursor-pointer`}
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
        {/* the prayers in use, at a fixed width so the selects line up */}
        <span className="flex shrink-0 w-9 gap-0.5" aria-hidden>
          {used.map((p) => <img key={p} className="w-4 h-4 object-contain" src={PrayerMap[p].image.src} alt="" title={PrayerMap[p].name} />)}
        </span>
      </div>
      {blocked !== undefined && (
        <p className="col-start-2 -mt-1 text-xs text-orange-700 dark:text-orange-200">
          {`${missingLevels(blocked, unlocks.prayerLevel, skills.def)}, so Auto is used`}
        </p>
      )}
    </>
  );
});

export default PrayerPicker;
