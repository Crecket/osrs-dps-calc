import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { observer } from 'mobx-react-lite';
import {
  IconEye, IconEyeOff, IconPlus, IconX,
} from '@tabler/icons-react';
import { GlobalState, StoreProvider } from '@/state';
import EquipmentSelect from '@/app/components/player/equipment/EquipmentSelect';
import { availableEquipment } from '@/lib/Equipment';
import { getCdnImage, PotionMap } from '@/utils';
import Potion from '@/enums/Potion';
import BuffItem from '@/app/components/player/buffs/BuffItem';
import { EquipmentPiece, PlayerEquipment } from '@/types/Player';
import { useBulkStore } from '@/bulk/state/BulkStore';
import { STYLE_GROUPS, styleLabel } from '@/bulk/lib/filters';
import { BulkFilters, GEAR_SLOT_ORDER } from '@/bulk/types';
import { inputClass } from '@/bulk/components/Panel';
import head from '@/public/img/slots/head.png';
import cape from '@/public/img/slots/cape.png';
import neck from '@/public/img/slots/neck.png';
import ammo from '@/public/img/slots/ammo.png';
import weapon from '@/public/img/slots/weapon.png';
import body from '@/public/img/slots/body.png';
import shield from '@/public/img/slots/shield.png';
import legs from '@/public/img/slots/legs.png';
import hands from '@/public/img/slots/hands.png';
import feet from '@/public/img/slots/feet.png';
import ring from '@/public/img/slots/ring.png';

const OVERRIDE_SLOTS = GEAR_SLOT_ORDER.filter((s) => s !== 'weapon');

// the items an override can use: anything for a non-weapon slot that isn't a broken or locked copy
const overridable = (e: EquipmentPiece) => OVERRIDE_SLOTS.includes(e.slot as keyof PlayerEquipment)
  && !/^(Broken|Inactive|Locked)$/.test(e.version || '');

const toggleClass = (on: boolean) => `px-2.5 py-1 text-sm ${on
  ? 'bg-orange-400 dark:bg-orange-700 text-white'
  : 'bg-btns-400 dark:bg-dark-500 text-gray-300 line-through'}`;

const chipClass = 'flex items-center gap-1 h-8 pl-1 pr-1.5 rounded border-2 border-orange-400 bg-body-100 dark:bg-dark-400 text-xs whitespace-nowrap';

// closes a popover on a click outside it or on Escape
const useCloseOnOutsideClick = (ref: React.RefObject<HTMLElement>, onClose: () => void) => {
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onClose]);
};

const SLOT_ICONS: Record<keyof PlayerEquipment, string> = {
  head: head.src,
  cape: cape.src,
  neck: neck.src,
  ammo: ammo.src,
  weapon: weapon.src,
  body: body.src,
  shield: shield.src,
  legs: legs.src,
  hands: hands.src,
  feet: feet.src,
  ring: ring.src,
};

// the calculator's equipment layout
const GRID_ROWS: { slots: (keyof PlayerEquipment)[]; gap: string }[] = [
  { slots: ['head'], gap: 'gap-2' },
  { slots: ['cape', 'neck', 'ammo'], gap: 'gap-2' },
  { slots: ['weapon', 'body', 'shield'], gap: 'gap-6' },
  { slots: ['legs'], gap: 'gap-2' },
  { slots: ['hands', 'feet', 'ring'], gap: 'gap-6' },
];

/**
 * The calculator's equipment grid, for choosing a slot: overridden slots show their item, the weapon can't be picked.
 */
const SlotGrid: React.FC<{
  overrides: BulkFilters['overrides'];
  selected: keyof PlayerEquipment | null;
  onSelect: (slot: keyof PlayerEquipment) => void;
}> = ({ overrides, selected, onSelect }) => (
  <div className="flex flex-col gap-1">
    {GRID_ROWS.map(({ slots, gap }) => (
      <div key={slots.join()} className={`flex justify-center ${gap}`}>
        {slots.map((slot) => {
          const overridden = slot in overrides;
          const id = overrides[slot];
          const item = id == null ? null : availableEquipment.find((e) => e.id === id);
          let tooltip = `Override ${slot}`;
          if (slot === 'weapon') tooltip = 'The weapon can\'t be overridden';
          else if (overridden) tooltip = item ? item.name : `No ${slot}`;
          return (
            <button
              key={slot}
              type="button"
              disabled={slot === 'weapon'}
              aria-label={`${slot} slot`}
              aria-pressed={selected === slot}
              data-tooltip-id="tooltip"
              data-tooltip-content={tooltip}
              className={`flex justify-center items-center h-[40px] w-[40px] rounded transition-colors bg-body-100 dark:bg-dark-400 disabled:opacity-30 disabled:cursor-not-allowed ${
                selected === slot || overridden ? 'border-2 border-orange-400' : 'border border-body-300 dark:border-dark-400 hover:border-orange-400'
              }`}
              onClick={() => onSelect(slot)}
            >
              {item?.image
                ? <img src={getCdnImage(`equipment/${item.image}`)} alt={item.name} />
                : <img className="opacity-30 dark:filter dark:invert" src={SLOT_ICONS[slot]} alt={slot} draggable={false} />}
            </button>
          );
        })}
      </div>
    ))}
  </div>
);

/**
 * Picks a slot, then an item for it (or an empty slot), to swap into every setup.
 */
const OverridePicker: React.FC<{
  overrides: BulkFilters['overrides'];
  onPick: (slot: keyof PlayerEquipment, id: number | null) => void;
  onClose: () => void;
}> = ({ overrides, onPick, onClose }) => {
  // upstream's item search reads the monster from a calculator store, so give it a scratch one
  const [scratch] = useState(() => new GlobalState());
  const [slot, setSlot] = useState<keyof PlayerEquipment | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // a stable filter, so the item list isn't rebuilt on every render
  const itemFilter = useMemo(() => (e: EquipmentPiece) => overridable(e) && e.slot === slot, [slot]);

  useCloseOnOutsideClick(ref, onClose);

  return (
    <div ref={ref} className="absolute z-20 top-full left-0 mt-1 p-3 w-80 rounded shadow-xl bg-tile dark:bg-dark-300 border border-body-300 dark:border-dark-200 text-black dark:text-white">
      <p className="text-xs mb-2 text-gray-500 dark:text-gray-300">Pick a slot to override in every setup:</p>
      <SlotGrid overrides={overrides} selected={slot} onSelect={setSlot} />
      {slot && (
        <div className="mt-2 flex flex-col gap-1.5">
          <StoreProvider store={scratch}>
            {/* keyed by slot, so switching slots starts a fresh search */}
            <EquipmentSelect
              key={slot}
              customAvailableEquipmentFilter={itemFilter}
              onSelectedItemChange={(item) => item && onPick(slot, item.equipment.id)}
            />
          </StoreProvider>
          <button type="button" className="self-start text-xs underline text-gray-500 dark:text-gray-300 hover:text-orange-300" onClick={() => onPick(slot, null)}>
            {`Or leave the ${slot} slot empty`}
          </button>
        </div>
      )}
    </div>
  );
};

/**
 * Potions used by every setup instead of its own (e.g. smelling salts or overloads in raids).
 */
const PotionOverride: React.FC = observer(() => {
  const store = useBulkStore();
  const { potions } = store.filters;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useCloseOnOutsideClick(ref, close);

  const toggle = (p: Potion) => {
    const current = potions ?? [];
    store.setFilters({ potions: current.includes(p) ? current.filter((x) => x !== p) : [...current, p] });
  };

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      {potions === null ? (
        <button
          type="button"
          className="flex items-center gap-0.5 h-8 px-2 rounded border border-dashed border-body-400 dark:border-dark-200 hover:border-orange-400 text-xs"
          onClick={() => setOpen(!open)}
        >
          <IconPlus size={14} />
          Override potions
        </button>
      ) : (
        <span className={chipClass} data-tooltip-id="tooltip" data-tooltip-content="Every setup uses these potions">
          <button type="button" className="flex items-center gap-0.5" aria-label="Change potion override" onClick={() => setOpen(!open)}>
            {potions.length === 0 ? 'No potions' : potions.map((p) => (
              <img key={p} className="w-5 h-5 object-contain" src={PotionMap[p].image.src} alt={PotionMap[p].name} />
            ))}
          </button>
          <button
            type="button"
            aria-label="Remove potion override"
            className="text-gray-400 hover:text-red-300"
            onClick={() => {
              store.setFilters({ potions: null });
              setOpen(false);
            }}
          >
            <IconX size={14} />
          </button>
        </span>
      )}
      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 p-2 rounded shadow-xl bg-tile dark:bg-dark-300 border border-body-300 dark:border-dark-200 text-black dark:text-white">
          <p className="text-xs mb-1 text-gray-500 dark:text-gray-300">Every setup uses these potions instead of its own:</p>
          <div className="w-64 max-h-72 overflow-y-auto bg-white dark:bg-dark-500 rounded border border-gray-300 dark:border-dark-200">
            {Object.entries(PotionMap).sort((a, b) => a[1].order - b[1].order).map(([k, v]) => {
              const p: Potion = parseInt(k);
              return (
                <BuffItem key={k} potion={p} name={v.name} image={v.image} active={!!potions?.includes(p)} setActive={toggle} />
              );
            })}
          </div>
          {potions === null && (
            <button type="button" className="mt-1 text-xs underline text-gray-500 dark:text-gray-300 hover:text-orange-300" onClick={() => store.setFilters({ potions: [] })}>
              Or use no potions at all
            </button>
          )}
        </div>
      )}
    </div>
  );
});

/**
 * Quick filters for the results: slot overrides (recalculated for every setup), attack styles and a minimum DPS.
 */
// filteredCount: how many results the filters (and override duplicates) take out, shown on the eye
const FilterBar: React.FC<{ filteredCount: number }> = observer(({ filteredCount }) => {
  const store = useBulkStore();
  const { filters } = store;
  const [picking, setPicking] = useState(false);
  const overrides = Object.entries(filters.overrides) as [keyof PlayerEquipment, number | null][];

  const setOverride = (slot: keyof PlayerEquipment, id: number | null | undefined) => {
    const next = { ...filters.overrides };
    if (id === undefined) delete next[slot];
    else next[slot] = id;
    store.setFilters({ overrides: next });
  };

  return (
    <div className="px-4 py-2 flex flex-wrap gap-3 items-center text-sm border-b border-body-200 dark:border-dark-400">
      <button
        type="button"
        className={`relative ${filters.showFiltered ? 'text-orange-400' : 'text-gray-400'} hover:text-orange-300`}
        aria-label={filters.showFiltered ? 'Hide filtered results' : 'Show filtered results greyed out'}
        data-tooltip-id="tooltip"
        data-tooltip-content={`${filteredCount} filtered out: ${filters.showFiltered ? 'shown greyed out' : 'hidden'}`}
        onClick={() => store.setFilters({ showFiltered: !filters.showFiltered })}
      >
        {filters.showFiltered ? <IconEye size={20} /> : <IconEyeOff size={20} />}
        {filteredCount > 0 && (
          <span className="absolute -top-2 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-orange-500 text-white text-[10px] leading-4 font-bold text-center tabular-nums">
            {filteredCount}
          </span>
        )}
      </button>

      <div className="flex rounded overflow-hidden border border-body-500 dark:border-dark-200">
        {STYLE_GROUPS.map((g) => {
          const hidden = filters.hiddenStyles.includes(g);
          return (
            <button
              key={g}
              type="button"
              className={toggleClass(!hidden)}
              aria-pressed={!hidden}
              onClick={() => store.setFilters({
                hiddenStyles: hidden ? filters.hiddenStyles.filter((x) => x !== g) : [...filters.hiddenStyles, g],
              })}
            >
              {styleLabel(g)}
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-1.5">
        <span>Min DPS</span>
        <input
          aria-label="Minimum DPS"
          type="number"
          min={0}
          step={0.5}
          className={`${inputClass} w-20`}
          value={filters.minDps ?? ''}
          placeholder="any"
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            store.setFilters({ minDps: Number.isFinite(v) && v > 0 ? v : null });
          }}
        />
      </div>

      <div className="relative flex flex-wrap gap-1 items-center">
        {overrides.map(([slot, id]) => {
          const item = id === null ? null : availableEquipment.find((e) => e.id === id);
          return (
            <span key={slot} className={chipClass} data-tooltip-id="tooltip" data-tooltip-content={`Every setup uses this ${slot}`}>
              {item?.image && <img className="max-w-[22px] max-h-[22px]" src={getCdnImage(`equipment/${item.image}`)} alt="" />}
              {item ? item.name : `No ${slot}`}
              <button type="button" aria-label={`Remove ${slot} override`} className="text-gray-400 hover:text-red-300" onClick={() => setOverride(slot, undefined)}>
                <IconX size={14} />
              </button>
            </span>
          );
        })}
        <button
          type="button"
          className="flex items-center gap-0.5 h-8 px-2 rounded border border-dashed border-body-400 dark:border-dark-200 hover:border-orange-400 text-xs"
          onClick={() => setPicking(!picking)}
        >
          <IconPlus size={14} />
          Override slot
        </button>
        {picking && (
          <OverridePicker
            overrides={filters.overrides}
            onPick={(slot, id) => {
              setOverride(slot, id);
              setPicking(false);
            }}
            onClose={() => setPicking(false)}
          />
        )}
      </div>

      <PotionOverride />
    </div>
  );
});

export default FilterBar;
