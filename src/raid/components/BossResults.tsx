import React from 'react';
import { observer } from 'mobx-react-lite';
import { RaidResult } from '@/raid/lib/runRaid';
import { formatTime } from '@/raid/lib/format';
import {
  ItemImage, ItemMenu, itemById, useItemMenu,
} from '@/raid/components/items';
import { DEFENCE_WEAPON_IDS, DEFENCE_WEAPONS } from '@/raid/types';

/** GearScape-style rows: per boss its specs, and per phase every weapon the loadout can use, the fastest in green */
const BossResults: React.FC<{ result: RaidResult }> = observer(({ result }) => {
  const menu = useItemMenu();
  const bosses = [...new Map(result.phases.map((p) => [p.bossId, p.bossName])).entries()];
  const pickSeconds = new Map(result.plan.picks.map((p) => [p.key, p.seconds]));

  return (
    <div className="flex flex-col divide-y divide-body-300 dark:divide-dark-200">
      {bosses.map(([bossId, bossName]) => {
        const phases = result.phases.filter((p) => p.bossId === bossId);
        const seconds = phases.reduce((n, p) => n + (pickSeconds.get(p.key) ?? 0), 0);
        return (
          <div key={bossId} className="py-2 flex flex-col gap-1" data-testid="boss-row">
            <div className="flex items-center gap-3 text-sm">
              <strong className="font-serif">{bossName}</strong>
              <span className="tabular-nums text-gray-500 dark:text-gray-300">{formatTime(seconds)}</span>
            </div>
            {phases.map((p) => (
              <div key={p.key} className="flex items-start gap-3">
                <div className="w-32 shrink-0 text-xs flex flex-col gap-1">
                  {phases.length > 1 && <span>{p.label}</span>}
                  <span className="flex gap-1.5">
                    {DEFENCE_WEAPONS.filter((w) => p.counts[w] > 0).map((w) => (
                      <span key={w} className="flex items-center">
                        <ItemImage id={DEFENCE_WEAPON_IDS[w]} size={16} />
                        <span className="tabular-nums">{p.counts[w]}</span>
                      </span>
                    ))}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(result.options[p.key] ?? []).map((o, i) => (
                    <div
                      key={o.weaponId}
                      className={`w-16 flex flex-col items-center text-xs tabular-nums ${i === 0 ? 'text-green-600 dark:text-green-400 font-semibold' : ''}`}
                      data-tooltip-id="tooltip"
                      data-tooltip-content={itemById(o.weaponId)?.name}
                      onContextMenu={menu.open(o.weaponId)}
                    >
                      <span className="w-9 h-9 flex items-center justify-center"><ItemImage id={o.weaponId} /></span>
                      <span>{o.dps.toFixed(2)}</span>
                      <span>{formatTime(o.seconds)}</span>
                    </div>
                  ))}
                  {(result.options[p.key] ?? []).length === 0 && <span className="text-xs text-gray-500 dark:text-gray-300">No usable setup</span>}
                </div>
              </div>
            ))}
          </div>
        );
      })}
      <ItemMenu target={menu.target} onClose={menu.close} />
    </div>
  );
});

export default BossResults;
