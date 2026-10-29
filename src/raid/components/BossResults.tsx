import React from 'react';
import { observer } from 'mobx-react-lite';
import { BestStyle } from '@/best/types';
import { RaidResult } from '@/raid/lib/runRaid';
import { formatTime } from '@/raid/lib/format';
import {
  ItemImage, ItemMenu, itemById, useItemMenu,
} from '@/raid/components/items';
import { DEFENCE_WEAPON_IDS, DEFENCE_WEAPONS, PhasePart } from '@/raid/types';

// spec weapons shown per phase, best damage per 1% energy first
const SPECS_SHOWN = 3;

const MELEE: BestStyle[] = ['stab', 'slash', 'crush'];
const partStyles = ({ styles }: PhasePart) => {
  if (!styles) return 'any style';
  if (styles.length === MELEE.length && MELEE.every((st) => styles.includes(st))) return 'melee';
  return styles.join('/');
};
/** e.g. "50% ranged · 50% any style" */
const partsLabel = (parts: PhasePart[]) => parts.map((p) => `${Math.round(p.share * 100)}% ${partStyles(p)}`).join(' · ');

/** GearScape-style rows: per boss its specs, and per phase every weapon the loadout can use, the fastest in green */
const BossResults: React.FC<{ result: RaidResult }> = observer(({ result }) => {
  const menu = useItemMenu();
  const bosses = [...new Map(result.phases.map((p) => [p.bossId, p.bossName])).entries()];
  // a phase with parts has a pick per part
  const pickSeconds = new Map<string, number>();
  result.plan.picks.forEach((p) => pickSeconds.set(p.key, (pickSeconds.get(p.key) ?? 0) + p.seconds));

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
                  {p.parts && <span className="text-gray-500 dark:text-gray-300">{partsLabel(p.parts)}</span>}
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
                {(result.specs?.[p.key] ?? []).length > 0 && (
                  <div className="flex flex-wrap items-start gap-2 pl-3 border-l border-body-300 dark:border-dark-200">
                    <span className="text-xs text-gray-500 dark:text-gray-300 w-10">Specs</span>
                    {result.specs[p.key].slice(0, SPECS_SHOWN).map((sp) => (
                      <div
                        key={sp.weaponId}
                        data-testid="spec-cell"
                        className="w-16 flex flex-col items-center text-xs tabular-nums"
                        data-tooltip-id="tooltip"
                        data-tooltip-content={`${itemById(sp.weaponId)?.name}: ${sp.expected.toFixed(1)} expected per ${sp.cost}% spec`}
                        onContextMenu={menu.open(sp.weaponId)}
                      >
                        <span className="w-9 h-9 flex items-center justify-center"><ItemImage id={sp.weaponId} /></span>
                        <span>{`${sp.perEnergy.toFixed(2)} / 1%`}</span>
                      </div>
                    ))}
                  </div>
                )}
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
