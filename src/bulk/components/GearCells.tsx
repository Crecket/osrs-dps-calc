import React from 'react';
import { observer } from 'mobx-react-lite';
import { EquipmentPiece, Player, PlayerEquipment } from '@/types/Player';
import { getCdnImage } from '@/utils';
import { GEAR_SLOT_ORDER } from '@/bulk/types';
import { weaponTooltip } from '@/bulk/lib/format';

// marked slots (the result filters' overrides) get an orange border, and markedNote in their tooltip; onItemContextMenu
// handles a right-click on a worn item, and itemHint (e.g. how to use that right-click) follows every worn item's tooltip
const GearCells: React.FC<{
  player: Player;
  marked?: (keyof PlayerEquipment)[];
  markedNote?: string;
  onItemContextMenu?: (slot: keyof PlayerEquipment, item: EquipmentPiece) => void;
  itemHint?: string;
}> = observer(({
  player, marked = [], markedNote = ' (override)', onItemContextMenu, itemHint,
}) => (
  <div className="flex gap-0.5">
    {GEAR_SLOT_ORDER.map((slot) => {
      const item = player.equipment[slot];
      const isMarked = marked.includes(slot);
      const name = item?.name || `No ${slot}`;
      return (
        <div
          key={slot}
          className={`w-8 h-8 shrink-0 flex items-center justify-center rounded border bg-body-100 dark:bg-dark-400 ${isMarked ? 'border-orange-400 border-2' : 'border-body-300 dark:border-dark-200'}`}
          data-tooltip-id="tooltip"
          data-tooltip-content={`${slot === 'weapon' ? weaponTooltip(player) : `${name}${isMarked ? markedNote : ''}`}${item && itemHint ? itemHint : ''}`}
          onContextMenu={item && onItemContextMenu ? (e) => {
            e.preventDefault();
            onItemContextMenu(slot, item);
          } : undefined}
        >
          {item?.image && (
            <img className="max-w-[28px] max-h-[28px]" src={getCdnImage(`equipment/${item.image}`)} alt={item.name} loading="lazy" />
          )}
        </div>
      );
    })}
  </div>
));

export default GearCells;
