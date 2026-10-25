import React, { useState } from 'react';
import { toJS } from 'mobx';
import { toast } from 'react-toastify';
import {
  IconChevronDown, IconChevronUp, IconInfoCircle, IconPlaylistAdd,
} from '@tabler/icons-react';
import { StyleOutcome } from '@/best/lib/run';
import { Alternative, groupByWeapon } from '@/best/lib/groups';
import { BulkStore } from '@/bulk/state/BulkStore';
import { notifyPresetsChanged } from '@/bulk/state/presetChannel';
import { newId } from '@/bulk/lib/presetIO';
import { SortState } from '@/bulk/lib/table';
import { BulkRow, BulkSetup } from '@/bulk/types';
import { EquipmentPiece } from '@/types/Player';
import { availableEquipment } from '@/lib/Equipment';
import BulkTable from '@/bulk/components/BulkTable';
import { focusRing, STYLE_ICONS, styleName } from '@/best/components/fields';

/**
 * Saves a result as a setup in the bulk tool's active preset, read fresh from storage so the bulk page's own state isn't
 * needed here.
 */
const addToBulkPreset = async (setup: BulkSetup) => {
  const bulk = new BulkStore();
  // load always leaves an active preset
  await bulk.load();
  const preset = bulk.active;
  if (!bulk.persists() || !preset) {
    toast.error('The bulk tool\'s presets could not be read, so the setup was not added');
    return;
  }
  const result = bulk.addSetups([{ id: newId(), name: setup.name, player: toJS(setup.player) }]);
  if (result.added === 0) {
    toast.info(`That setup is already in ${preset.name}`);
    return;
  }
  if (!await bulk.whenSaved()) {
    toast.error('Could not save the bulk tool\'s presets');
    return;
  }
  notifyPresetsChanged();
  toast.success(`Added to ${preset.name}`);
};

/**
 * The variants a weapon's row stands for that are copies of it (Holy Scythe of Vitur, Armadyl godsword (or)): their
 * names contain its name. Other weapons that only calculate the same here (the other godswords) are items of their own.
 */
const cosmeticVariants = (weapon: EquipmentPiece, variants: number[]) => variants.filter((id) => availableEquipment
  .find((e) => e.id === id)?.name.toLowerCase().includes(weapon.name.toLowerCase()));

export const styleSectionId = (outcome: StyleOutcome) => `best-${outcome.style}`;

const iconButton = `inline-flex items-center justify-center w-7 h-7 rounded text-gray-500 dark:text-gray-300 hover:bg-body-200 dark:hover:bg-dark-400 hover:text-orange-400 dark:hover:text-orange-300 ${focusRing}`;

/**
 * One style's results: each searched weapon's best setup, ranked, with its runners-up (the same weapon with small gear
 * changes) folded under it. The style's best DPS setup is highlighted.
 */
const StyleResults: React.FC<{
  outcome: StyleOutcome;
  sort: SortState;
  onSort: (s: SortState) => void;
  onExclude: (item: EquipmentPiece, variants: number[]) => void;
}> = ({
  outcome, sort, onSort, onExclude,
}) => {
  // weapons whose alternatives are shown
  const [open, setOpen] = useState<Set<number | null>>(new Set());
  const setupsById = new Map(outcome.setups.map((s) => [s.id, s]));
  const groups = groupByWeapon(outcome.rows, outcome.setups, sort);
  const best = outcome.rows.reduce<BulkRow | null>((b, r) => (!r.error && (!b || r.dps > b.dps) ? r : b), null);

  const rows = groups.flatMap((g) => [g.lead, ...(open.has(g.weaponId) ? g.alternatives.map((a) => a.row) : [])]);
  const alternatives = new Map<string, Alternative>(groups.flatMap((g) => g.alternatives.map((a) => [a.row.setupId, a])));
  const groupOfLead = new Map(groups.map((g) => [g.lead.setupId, g]));

  const toggle = (weaponId: number | null) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(weaponId)) next.delete(weaponId);
    else next.add(weaponId);
    return next;
  });

  return (
    <section id={styleSectionId(outcome)} className="scroll-mt-32" aria-labelledby={`${styleSectionId(outcome)}-title`}>
      <div className="px-4 py-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-body-300 dark:border-dark-200">
        <img className="w-5 h-5 object-contain" src={STYLE_ICONS[outcome.style].src} alt="" />
        <h3 id={`${styleSectionId(outcome)}-title`} className="font-serif font-bold text-lg tracking-tight">{styleName(outcome.style)}</h3>
        {outcome.approximate && (
          <span
            className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded bg-orange-100 text-orange-500 dark:bg-orange-500/40 dark:text-orange-200 cursor-help"
            data-tooltip-id="tooltip"
            data-tooltip-content="Some of these setups come from a quicker search that may miss the best one"
          >
            <IconInfoCircle size={14} aria-hidden />
            Approximate
          </span>
        )}
        {groups.length > 0 && (
          <span className="ml-auto text-xs text-gray-500 dark:text-gray-300">
            {groups.length === 1 ? 'Top weapon' : `Top ${groups.length} weapons`}
          </span>
        )}
      </div>
      {outcome.message ? (
        <p className="px-4 py-5 text-sm text-gray-500 dark:text-gray-300">
          {`${outcome.message}. No weapon the search can use damages this monster with ${styleName(outcome.style).toLowerCase()}; check your excluded items if that's unexpected.`}
        </p>
      ) : (
        <div className="overflow-x-auto max-w-[100vw]">
          <BulkTable
            rows={rows}
            setups={outcome.setups}
            mode="normal"
            sort={sort}
            onSort={onSort}
            hasRun
            highlightId={best?.setupId}
            alternatives={alternatives}
            leadColumns={['dps', 'maxHit']}
            hideNames
            itemHint=". Right-click to exclude"
            onItemContextMenu={(slot, item) => onExclude(item, slot === 'weapon' ? cosmeticVariants(item, outcome.variants[item.id] ?? []) : [])}
            rowAction={(id) => {
              const setup = setupsById.get(id);
              const group = groupOfLead.get(id);
              const more = group?.alternatives.length ?? 0;
              const isOpen = group !== undefined && open.has(group.weaponId);
              const weapon = setup?.player.equipment.weapon?.name ?? 'this weapon';
              return setup && (
                <span className="inline-flex items-center justify-end gap-1">
                  {more > 0 && (
                    <button
                      type="button"
                      className={`inline-flex items-center gap-0.5 h-7 px-1.5 rounded text-xs text-gray-600 dark:text-gray-300 hover:bg-body-200 dark:hover:bg-dark-400 ${focusRing}`}
                      aria-expanded={isOpen}
                      aria-label={`${isOpen ? 'Hide' : 'Show'} ${more} more ${more === 1 ? 'setup' : 'setups'} with ${weapon}`}
                      onClick={() => toggle(group!.weaponId)}
                    >
                      {isOpen ? <IconChevronUp size={14} aria-hidden /> : <IconChevronDown size={14} aria-hidden />}
                      {`${more} more`}
                    </button>
                  )}
                  <button
                    type="button"
                    className={iconButton}
                    aria-label="Add to bulk preset"
                    data-tooltip-id="tooltip"
                    data-tooltip-content="Add to the bulk tool's preset"
                    onClick={() => {
                      // an alternative keeps its weapon's name, so say what sets it apart
                      const alt = alternatives.get(id);
                      const named = alt ? { ...setup, name: `${setup.name} ${alt.label.replace(/^With /, 'with ')}` } : setup;
                      addToBulkPreset(named).catch((e) => toast.error(e instanceof Error ? e.message : String(e)));
                    }}
                  >
                    <IconPlaylistAdd size={18} aria-hidden />
                  </button>
                </span>
              );
            }}
          />
        </div>
      )}
    </section>
  );
};

export default StyleResults;
