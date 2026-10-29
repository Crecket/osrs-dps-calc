import React from 'react';
import { observer } from 'mobx-react-lite';
import { useRaidStore } from '@/raid/state/RaidStore';
import { raidById } from '@/raid/raids';
import { routeBosses, routePhases } from '@/raid/lib/route';
import {
  DEFENCE_WEAPON_IDS, DEFENCE_WEAPON_NAMES, DEFENCE_WEAPONS,
} from '@/raid/types';
import { ItemImage } from '@/raid/components/items';
import { fieldClass } from '@/best/components/fields';

/** The route's bosses in a row that scrolls sideways, each phase with its defence reduction specs */
const BossStrip: React.FC = observer(() => {
  const store = useRaidStore();
  const { settings } = store;
  const raid = raidById(settings.raidId);
  const phases = routePhases(raid, settings.route, settings.counts, settings.excludedIds);

  return (
    <div className="flex gap-3 overflow-x-auto pb-2" aria-label="Defence reduction per boss">
      {routeBosses(raid, settings.route).map((boss) => (
        <div key={boss.id} className="shrink-0 rounded border border-body-300 dark:border-dark-200 p-2 flex flex-col gap-1.5">
          <h4 className="font-serif font-bold text-sm">{boss.name}</h4>
          {phases.filter((p) => p.boss.id === boss.id).map((p) => (
            <div key={p.phase.key} className="flex items-center gap-2 text-xs">
              {boss.phases.length > 1 && <span className="w-20 truncate">{p.phase.label}</span>}
              {DEFENCE_WEAPONS.map((w) => (
                <span key={w} className="flex items-center gap-0.5" data-tooltip-id="tooltip" data-tooltip-content={`${DEFENCE_WEAPON_NAMES[w]} specs`}>
                  <ItemImage id={DEFENCE_WEAPON_IDS[w]} size={20} />
                  <input
                    type="number"
                    min={0}
                    max={20}
                    aria-label={`${boss.name} ${p.phase.label} ${DEFENCE_WEAPON_NAMES[w]} specs`}
                    className={`${fieldClass} w-12`}
                    value={p.counts[w]}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (e.target.value !== '' && Number.isInteger(n)) store.setCount(p.phase.key, w, n);
                    }}
                  />
                </span>
              ))}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
});

export default BossStrip;
