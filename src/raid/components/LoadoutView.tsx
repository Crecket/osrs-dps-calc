import React from 'react';
import { observer } from 'mobx-react-lite';
import { IconAlertTriangle } from '@tabler/icons-react';
import { PlayerEquipment } from '@/types/Player';
import { useRaidStore } from '@/raid/state/RaidStore';
import { RaidResult } from '@/raid/lib/runRaid';
import { InvCell, SupplyLabel, WornSlot } from '@/raid/lib/layout';
import { itemPrice, Prices } from '@/raid/lib/prices';
import { getCanonicalItemId } from '@/lib/Equipment';
import superCombatIcon from '@/public/img/potions/Super combat.png';
import { formatGp, formatTime } from '@/raid/lib/format';
import {
  ItemImage, ItemMenu, itemById, priceLabel, useItemMenu,
} from '@/raid/components/items';

// the in-game equipment tab: 3 columns, 5 rows; null is a gap
const EQUIPMENT_GRID: (WornSlot | null)[] = [
  null, 'head', 'quiverAmmo',
  'cape', 'neck', 'ammo',
  'weapon', 'body', 'shield',
  null, 'legs', null,
  'hands', 'feet', 'ring',
];

// the OSRS Wiki's item icons; reserved slots (boost potions and the like) show a faded potion
const WIKI_IMAGES = 'https://oldschool.runescape.wiki/images';
const SUPPLY_ICON: Record<SupplyLabel, { src: string; alt: string; faded?: boolean }> = {
  Brew: { src: `${WIKI_IMAGES}/Saradomin_brew(4).png`, alt: 'Saradomin brew(4)' },
  Restore: { src: `${WIKI_IMAGES}/Super_restore(4).png`, alt: 'Super restore(4)' },
  'Rune pouch': { src: `${WIKI_IMAGES}/Rune_pouch.png`, alt: 'Rune pouch' },
  Reserved: { src: superCombatIcon.src, alt: 'Reserved slot', faded: true },
};
const SUPPLY_TOOLTIP: Record<SupplyLabel, string> = {
  Brew: 'Saradomin brew', Restore: 'Super restore', 'Rune pouch': 'Rune pouch', Reserved: 'Reserved (boost potions and the like)',
};

const cellClass = 'w-12 h-12 flex items-center justify-center rounded border border-[#3e3529] bg-[#3e3529]/70';
const ICON_SIZE = 36;

const LoadoutView: React.FC<{ result: RaidResult; prices: Prices | null }> = observer(({ result, prices }) => {
  const store = useRaidStore();
  const menu = useItemMenu();
  const { owned } = { owned: store.settings.ownedIds };
  const { plan, layout } = result;

  const itemCell = (id: number, key: string) => (
    <div
      key={key}
      className={cellClass}
      data-testid="item-cell"
      data-tooltip-id="tooltip"
      data-tooltip-content={`${itemById(id)?.name ?? id} — ${priceLabel(id, prices, owned)}`}
      onContextMenu={menu.open(id)}
    >
      <ItemImage id={id} size={ICON_SIZE} />
    </div>
  );

  const invCell = (cell: InvCell, i: number) => {
    if (cell === null) return <div key={i} className={cellClass} data-testid="inv-cell" />;
    if (cell.kind === 'item') return <div key={i} data-testid="inv-cell">{itemCell(cell.itemId, `i${i}`)}</div>;
    const icon = SUPPLY_ICON[cell.label];
    return (
      <div key={i} data-testid="inv-cell" className={cellClass} data-tooltip-id="tooltip" data-tooltip-content={SUPPLY_TOOLTIP[cell.label]}>
        <img style={{ maxWidth: ICON_SIZE, maxHeight: ICON_SIZE }} className={icon.faded ? 'opacity-40 grayscale' : ''} src={icon.src} alt={icon.alt} loading="lazy" />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          Raid time
          {' '}
          <strong className="tabular-nums">{formatTime(plan.totalSeconds)}</strong>
        </span>
        <span>
          Cost
          {' '}
          <strong className="tabular-nums">{`${formatGp(plan.cost)} gp`}</strong>
          {' of '}
          {`${formatGp(store.settings.budget)} gp`}
        </span>
        <span data-testid="owned-value" className="text-gray-500 dark:text-gray-300">
          {(() => {
            const ownedSet = new Set(owned);
            const used = plan.itemIds.filter((id) => ownedSet.has(getCanonicalItemId(id)));
            const worth = used.reduce((n, id) => n + itemPrice(id, prices, new Set()), 0);
            return `+ ${used.length} owned item${used.length === 1 ? '' : 's'} worth ${formatGp(worth)} gp`;
          })()}
        </span>
        {plan.overBudget && (
          <span className="flex items-center gap-1 text-orange-500 dark:text-orange-200">
            <IconAlertTriangle size={14} aria-hidden />
            The required items alone cost more than the budget
          </span>
        )}
        {layout.overflow > 0 && (
          <span className="flex items-center gap-1 text-orange-500 dark:text-orange-200">
            <IconAlertTriangle size={14} aria-hidden />
            {`${layout.overflow} switch${layout.overflow > 1 ? 'es don\'t' : ' doesn\'t'} fit in the inventory`}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-6 items-start">
        <div className="p-2 rounded bg-[#5a4d3c] grid grid-cols-3 gap-1.5" data-testid="equipment-grid" aria-label="Worn equipment">
          {EQUIPMENT_GRID.map((slot, i) => {
            const id = slot ? layout.worn[slot] : undefined;
            // the grid's positions never move, so they make stable keys
            const key = slot ?? `gap${i}`;
            if (slot === null || (slot === 'quiverAmmo' && id === undefined)) return <div key={key} className="w-12 h-12" />;
            if (id === undefined) {
              return <div key={key} className={`${cellClass} opacity-50`} data-tooltip-id="tooltip" data-tooltip-content={`No ${slot as keyof PlayerEquipment}`} />;
            }
            return itemCell(id, key);
          })}
        </div>
        <div className="p-2 rounded bg-[#5a4d3c] grid grid-cols-4 gap-1.5" data-testid="inventory-grid" aria-label="Inventory">
          {layout.inventory.map(invCell)}
        </div>
      </div>
      <ItemMenu target={menu.target} onClose={menu.close} />
    </div>
  );
});

export default LoadoutView;
