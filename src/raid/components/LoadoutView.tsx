import React from 'react';
import { observer } from 'mobx-react-lite';
import { IconAlertTriangle } from '@tabler/icons-react';
import { PlayerEquipment } from '@/types/Player';
import { useRaidStore } from '@/raid/state/RaidStore';
import { RaidResult } from '@/raid/lib/runRaid';
import {
  InvCell, reservedPotions, SupplyLabel, WornSlot,
} from '@/raid/lib/layout';
import { itemPrice, Prices } from '@/raid/lib/prices';
import { getCanonicalItemId } from '@/lib/Equipment';
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

// the OSRS Wiki's item icons; reserved slots (boost potions and the like) show placeholder boost potions
const WIKI_IMAGES = 'https://oldschool.runescape.wiki/images';
const wikiIcon = (name: string) => `${WIKI_IMAGES}/${name.replace(/ /g, '_')}(4).png`;
const SUPPLY_ICON: Record<Exclude<SupplyLabel, 'Reserved'>, { src: string; alt: string }> = {
  Brew: { src: `${WIKI_IMAGES}/Saradomin_brew(4).png`, alt: 'Saradomin brew(4)' },
  Restore: { src: `${WIKI_IMAGES}/Super_restore(4).png`, alt: 'Super restore(4)' },
  'Rune pouch': { src: `${WIKI_IMAGES}/Rune_pouch.png`, alt: 'Rune pouch' },
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

  const firstReserved = layout.inventory.findIndex((c) => c?.kind === 'supply' && c.label === 'Reserved');
  const potions = reservedPotions(layout.inventory.filter((c) => c?.kind === 'supply' && c.label === 'Reserved').length);
  const invCell = (cell: InvCell, i: number) => {
    if (cell === null) return <div key={i} className={cellClass} data-testid="inv-cell" />;
    if (cell.kind === 'item') return <div key={i} data-testid="inv-cell">{itemCell(cell.itemId, `i${i}`)}</div>;
    const potion = cell.label === 'Reserved' ? potions[i - firstReserved] : null;
    const icon = potion ? { src: wikiIcon(potion), alt: `${potion}(4)` } : SUPPLY_ICON[cell.label as Exclude<SupplyLabel, 'Reserved'>];
    const tooltip = potion ? `Reserved: ${potion} (or any other boost)` : SUPPLY_TOOLTIP[cell.label];
    return (
      <div key={i} data-testid="inv-cell" className={cellClass} data-tooltip-id="tooltip" data-tooltip-content={tooltip}>
        <img style={{ maxWidth: ICON_SIZE, maxHeight: ICON_SIZE }} src={icon.src} alt={icon.alt} loading="lazy" />
      </div>
    );
  };

  // what the loadout costs, the dearest item first; owned items cost nothing
  const ownedIds = new Set(owned.map(getCanonicalItemId));
  const costs = plan.itemIds
    .map((id) => ({ id, price: ownedIds.has(getCanonicalItemId(id)) ? 0 : itemPrice(id, prices, new Set()) }))
    .sort((a, b) => b.price - a.price);

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
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
      <div className="flex flex-wrap gap-3 items-start">
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
      <div className="min-h-0 flex flex-col gap-1">
        <h3 className="text-sm font-bold">Cost breakdown</h3>
        <ul className="min-h-0 overflow-y-auto max-h-80 xl:max-h-none rounded border border-body-200 dark:border-dark-300 divide-y divide-body-200 dark:divide-dark-300 text-sm" data-testid="cost-list">
          {costs.map(({ id, price }) => (
            <li key={id} className="flex items-center gap-2 px-2 py-1" data-testid="cost-row" onContextMenu={menu.open(id)}>
              <ItemImage id={id} size={20} />
              <span className="grow truncate">{itemById(id)?.name ?? id}</span>
              <span className="tabular-nums text-gray-500 dark:text-gray-300 shrink-0">{price > 0 ? `${formatGp(price)} gp` : priceLabel(id, prices, owned).replace(' (untradeable or no price)', '')}</span>
            </li>
          ))}
        </ul>
      </div>
      <ItemMenu target={menu.target} onClose={menu.close} />
    </div>
  );
});

export default LoadoutView;
