import React from 'react';
import { observer } from 'mobx-react-lite';
import { Player } from '@/types/Player';
import { getCdnImage } from '@/utils';
import { GEAR_SLOT_ORDER } from '@/bulk/types';

const GearCells: React.FC<{ player: Player }> = observer(({ player }) => (
  <div className="flex gap-0.5">
    {GEAR_SLOT_ORDER.map((slot) => {
      const item = player.equipment[slot];
      return (
        <div
          key={slot}
          className="w-8 h-8 shrink-0 flex items-center justify-center rounded border border-body-300 dark:border-dark-200 bg-body-100 dark:bg-dark-400"
          data-tooltip-id="tooltip"
          data-tooltip-content={item ? item.name : `No ${slot}`}
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
