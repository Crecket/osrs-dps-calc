import React from 'react';
import { observer } from 'mobx-react-lite';
import { PrayerMap } from '@/enums/Prayer';
import { PotionMap } from '@/utils';
import { Player } from '@/types/Player';

/**
 * A setup's active prayers and potions as small icons.
 */
const BuffIcons: React.FC<{ player: Player; which?: 'prayers' | 'potions' | 'both' }> = observer(({ player, which = 'both' }) => {
  const icons = [
    ...(which !== 'potions' ? player.prayers.map((p) => ({ key: `prayer-${p}`, data: PrayerMap[p] })) : []),
    ...(which !== 'prayers' ? player.buffs.potions.map((p) => ({ key: `potion-${p}`, data: PotionMap[p] })) : []),
  ]
    // skip prayers and potions this version doesn't know (e.g. saved by a newer build)
    .flatMap(({ key, data }) => (data ? [{ key, ...data }] : []));
  return (
    <span className="inline-flex items-center gap-0.5">
      {icons.map((i) => (
        <img
          key={i.key}
          src={i.image.src}
          alt={i.name}
          className="w-5 h-5 shrink-0 object-contain"
          data-tooltip-id="tooltip"
          data-tooltip-content={i.name}
        />
      ))}
    </span>
  );
});

export default BuffIcons;
