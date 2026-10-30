import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'react-toastify';
import { IconX } from '@tabler/icons-react';
import { GlobalState, StoreProvider } from '@/state';
import EquipmentSelect from '@/app/components/player/equipment/EquipmentSelect';
import { bestPool } from '@/best/lib/candidates';
import { dartOptions } from '@/raid/lib/runRaid';
import { EquipmentPiece } from '@/types/Player';
import { useRaidStore } from '@/raid/state/RaidStore';
import { raidById } from '@/raid/raids';
import { MagicOption } from '@/raid/types';
import { Supplies } from '@/raid/lib/layout';
import { formatGp, parseGp } from '@/raid/lib/format';
import { ItemImage, itemById } from '@/raid/components/items';
import Panel, { buttonClass } from '@/bulk/components/Panel';
import {
  Check, FieldGrid, FieldLabel, fieldClass, focusRing, NumberField, Section,
} from '@/best/components/fields';

const MAGIC: [MagicOption, string][] = [
  ['thralls', 'Thralls (Book of the Dead + rune pouch)'],
  ['ancients', 'Ancients (rune pouch)'],
  ['standard', 'Standard spells (rune pouch)'],
  ['none', 'No spells'],
];

const SUPPLIES: [keyof Supplies, string][] = [['brews', 'Brews'], ['restores', 'Restores'], ['reserved', 'Other reserved']];

/** A GP field that takes "100m" or "4.5b"; it saves on blur or Enter, so a half-typed amount never counts */
const BudgetField: React.FC = observer(() => {
  const store = useRaidStore();
  const { budget } = store.settings;
  const [text, setText] = useState(formatGp(budget));
  useEffect(() => setText(formatGp(budget)), [budget]);
  const commit = () => {
    const gp = parseGp(text);
    if (gp !== null) store.setBudget(gp);
    setText(formatGp(gp ?? budget));
  };
  return (
    <>
      <FieldLabel htmlFor="raid-budget" label="Budget" />
      <input
        id="raid-budget"
        className={`${fieldClass} w-28`}
        value={text}
        placeholder="e.g. 100m or 4b"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </>
  );
});

const ItemChips: React.FC<{ ids: number[]; onRemove: (id: number) => void; removeLabel: string }> = ({ ids, onRemove, removeLabel }) => (
  <div className="flex flex-wrap gap-1.5">
    {ids.map((id) => (
      <span key={id} className="flex items-center gap-1 h-7 pl-1 pr-0.5 rounded border border-body-400 dark:border-dark-200 bg-body-100 dark:bg-dark-400 text-xs">
        <ItemImage id={id} size={20} />
        {itemById(id)?.name ?? id}
        <button
          type="button"
          className={`p-1 rounded text-gray-500 dark:text-gray-300 hover:text-orange-400 ${focusRing}`}
          aria-label={`${removeLabel} ${itemById(id)?.name ?? id}`}
          onClick={() => onRemove(id)}
        >
          <IconX size={12} />
        </button>
      </span>
    ))}
  </div>
);

type AddMode = 'owned' | 'bring' | 'exclude';
const ADD_MODES: [AddMode, string][] = [['owned', 'Mark owned'], ['bring', 'Always bring'], ['exclude', 'Exclude']];

let poolIds: Set<number> | null = null;
// only items the search could pick
const inPool = (e: EquipmentPiece) => {
  if (!poolIds) poolIds = new Set(bestPool().map((p) => p.id));
  return poolIds.has(e.id);
};

/** An item search, like the best setup page's: the picked item is marked owned, always brought or excluded */
const ItemSearch: React.FC = observer(() => {
  const store = useRaidStore();
  const [mode, setMode] = useState<AddMode>('owned');
  // upstream's item search reads the monster from a calculator store, so give it a scratch one
  const [scratch] = useState(() => new GlobalState());
  const add = (id: number) => {
    if (mode === 'owned') {
      if (!store.settings.ownedIds.includes(id)) store.toggleOwned(id);
    } else if (mode === 'bring') {
      store.bring(id);
    } else {
      store.exclude(id);
    }
  };
  return (
    <div className="flex gap-2 items-center">
      <select aria-label="What to do with the item" className={`${fieldClass} shrink-0`} value={mode} onChange={(e) => setMode(e.target.value as AddMode)}>
        {ADD_MODES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
      <div className="grow min-w-0">
        <StoreProvider store={scratch}>
          <EquipmentSelect customAvailableEquipmentFilter={inPool} onSelectedItemChange={(item) => item && add(item.equipment.id)} />
        </StoreProvider>
      </div>
    </div>
  );
});

/** Raid, route, budget, supplies, magic, rules, and the owned and excluded items */
const RaidInputs: React.FC = observer(() => {
  const store = useRaidStore();
  const { settings } = store;
  const raid = raidById(settings.raidId);
  const [paste, setPaste] = useState('');

  const importOwned = () => {
    try {
      const added = store.importOwned(paste);
      setPaste('');
      toast.success(`Marked ${added} item${added === 1 ? '' : 's'} as owned.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Panel title={raid.name} className="min-w-0">
      <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-5">
        <Section title="Route">
          <FieldGrid wide>
            {raid.stops.filter((s) => s.options.length > 1).map((stop) => (
              <React.Fragment key={stop.id}>
                <FieldLabel htmlFor={`stop-${stop.id}`} label={stop.label} />
                <select
                  id={`stop-${stop.id}`}
                  className={fieldClass}
                  value={settings.route[stop.id] ?? stop.options[0].id}
                  onChange={(e) => store.setRoute(stop.id, e.target.value)}
                >
                  {stop.options.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </React.Fragment>
            ))}
            <BudgetField />
          </FieldGrid>
        </Section>
        <Section title="Inventory">
          <FieldGrid wide>
            {SUPPLIES.map(([k, label]) => (
              <NumberField key={k} label={label} value={settings.supplies[k]} min={0} max={28} onChange={(v) => v !== null && store.setSupplies({ [k]: v })} />
            ))}
            <FieldLabel htmlFor="raid-magic" label="Magic" />
            <select id="raid-magic" className={fieldClass} value={settings.magic} onChange={(e) => store.setMagic(e.target.value as MagicOption)}>
              {MAGIC.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
            <FieldLabel htmlFor="raid-dart" label="Blowpipe darts" />
            <select
              id="raid-dart"
              className={fieldClass}
              value={settings.bestDart ?? ''}
              onChange={(e) => store.setBestDart(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Any</option>
              {dartOptions().map((d) => <option key={d.id} value={d.id}>{`${d.name} or weaker`}</option>)}
            </select>
            <Check label="Boss rules" checked={settings.rulesOn} onChange={store.setRulesOn} />
          </FieldGrid>
          <p className="text-xs text-gray-500 dark:text-gray-300">Boss rules: Moia needs a Venator bow, the Dagon&apos;hai need elemental spells.</p>
        </Section>
        <Section title="Items">
          <p className="text-xs text-gray-500 dark:text-gray-300">
            Owned items cost nothing, always-brought items are in every loadout, excluded ones never. Search for an item, right-click one in the results, or paste a RuneLite Inventory Setups export to mark it owned.
          </p>
          <ItemSearch />
          <textarea
            className={`${fieldClass} h-16 font-mono text-xs`}
            aria-label="Inventory Setups export"
            value={paste}
            placeholder='{"setup":{"inv":[...'
            onChange={(e) => setPaste(e.target.value)}
          />
          <div className="flex gap-2">
            <button type="button" className={`${buttonClass} h-8 ${focusRing}`} disabled={!paste.trim()} onClick={importOwned}>Mark as owned</button>
            {settings.ownedIds.length > 0 && (
              <button type="button" className={`${buttonClass} h-8 ${focusRing}`} onClick={store.clearOwned}>Clear owned</button>
            )}
          </div>
          {settings.ownedIds.length > 0 && (
            <>
              <h4 className="font-serif font-bold text-sm">Owned</h4>
              <ItemChips ids={settings.ownedIds} onRemove={store.toggleOwned} removeLabel="Unmark" />
            </>
          )}
          {settings.bringIds.length > 0 && (
            <>
              <h4 className="font-serif font-bold text-sm">Always bring</h4>
              <ItemChips ids={settings.bringIds} onRemove={store.unbring} removeLabel="Stop bringing" />
            </>
          )}
          {settings.excludedIds.length > 0 && (
            <>
              <h4 className="font-serif font-bold text-sm">Excluded</h4>
              <ItemChips ids={settings.excludedIds} onRemove={store.include} removeLabel="Include" />
            </>
          )}
        </Section>
      </div>
    </Panel>
  );
});

export default RaidInputs;
