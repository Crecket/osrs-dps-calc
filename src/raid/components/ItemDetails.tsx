import React, { useEffect, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { getCanonicalItemId } from '@/lib/Equipment';
import { RaidResult } from '@/raid/lib/runRaid';
import { Replacement } from '@/raid/lib/itemValue';
import { Prices } from '@/raid/lib/prices';
import { formatGp, formatTime } from '@/raid/lib/format';
import { ItemImage, itemById, priceLabel } from '@/raid/components/items';

const REPLACEMENTS_SHOWN = 25;
const WEAPONS_SHOWN = 8;

/** "+3.2s" slower, "−1.0s" faster */
export const deltaLabel = (seconds: number) => `${seconds > 0 ? '+' : '−'}${Math.abs(seconds).toFixed(1)}s`;

/** What the item saves over the raid, for its tooltip; empty when the result doesn't say */
export const worthLabel = (result: RaidResult, id: number): string => {
  if (!result.worths) return '';
  const worth = result.worths[id];
  if (!worth) return 'spec, drain or required item';
  if (!Number.isFinite(worth.seconds)) return 'nothing else in the loadout can deal its phases';
  const instead = worth.instead === null ? 'an empty slot' : itemById(worth.instead)?.name ?? worth.instead;
  return `saves ${worth.seconds.toFixed(1)}s over the raid (next best: ${instead})`;
};

const rowClass = 'grid grid-cols-[1.75rem_minmax(0,1fr)_4rem_4.5rem] items-center gap-2 px-1 py-1 rounded text-xs tabular-nums';

/**
 * An item of the loadout: what it saves, and what else could stand in its slot, rated in every setup wearing it. A
 * weapon shows the phases it is used on with their fastest weapons instead.
 */
const ItemDetails: React.FC<{
  result: RaidResult;
  id: number;
  prices: Prices | null;
  owned: number[];
  load: (id: number) => Promise<Replacement[] | null>;
  onClose: () => void;
}> = ({
  result, id, prices, owned, load, onClose,
}) => {
  const [rows, setRows] = useState<Replacement[] | null | 'loading' | 'failed'>('loading');
  const item = itemById(id);
  const canonical = getCanonicalItemId(id);
  const weaponPicks = result.plan.picks.filter((p) => p.candidate
    && getCanonicalItemId(p.candidate.setup.player.equipment.weapon!.id) === canonical);
  const isWeapon = weaponPicks.length > 0;

  useEffect(() => {
    if (isWeapon) return undefined;
    let live = true;
    setRows('loading');
    load(id).then((r) => {
      if (live) setRows(r);
    }).catch(() => {
      if (live) setRows('failed');
    });
    return () => {
      live = false;
    };
  }, [id, isWeapon, load]);

  const phaseLabel = (key: string) => {
    const p = result.phases.find((x) => x.key === key);
    return p ? `${p.bossName}${p.label !== p.bossName ? ` — ${p.label}` : ''}` : key;
  };

  return (
    <section data-testid="item-details" className="rounded border border-body-300 dark:border-dark-200 bg-body-100/60 dark:bg-dark-500/60 p-2 flex flex-col gap-2">
      <header className="flex items-center gap-2">
        <ItemImage id={id} size={28} />
        <div className="grow min-w-0">
          <h3 className="text-sm font-bold truncate">{item?.name ?? id}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-300">{[priceLabel(id, prices, owned), worthLabel(result, id)].filter(Boolean).join(' · ')}</p>
        </div>
        <button type="button" aria-label="Close" className="p-1 rounded hover:bg-body-200 dark:hover:bg-dark-400" onClick={onClose}>
          <IconX size={16} aria-hidden />
        </button>
      </header>
      {isWeapon && [...new Set(weaponPicks.map((p) => p.key))].map((key) => {
        const tiers = result.tiers?.[key] ?? [];
        return (
          <div key={key}>
            <h4 className="text-xs font-semibold px-1 pb-1">{`${phaseLabel(key)}: fastest weapons`}</h4>
            {tiers.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-300 px-1">Run again to see the other weapons.</p>}
            <ol>
              {tiers.slice(0, WEAPONS_SHOWN).map((t) => (
                <li key={`${t.weaponId}-${t.style}`} className={`${rowClass} ${getCanonicalItemId(t.weaponId) === canonical ? 'bg-orange-100 dark:bg-orange-900/40' : ''}`}>
                  <span className="flex items-center justify-center"><ItemImage id={t.weaponId} size={22} /></span>
                  <span className="truncate">{itemById(t.weaponId)?.name ?? t.weaponId}</span>
                  <span className="text-right">{formatTime(t.seconds)}</span>
                  <span className="text-right text-gray-500 dark:text-gray-300">{t.held ? 'held' : `${formatGp(t.cost)} gp`}</span>
                </li>
              ))}
            </ol>
          </div>
        );
      })}
      {!isWeapon && (
        <div>
          <h4 className="text-xs font-semibold px-1 pb-1">Instead of it, in every setup wearing it: raid time change</h4>
          {rows === 'loading' && <p className="text-xs px-1">Rating replacements…</p>}
          {rows === 'failed' && <p className="text-xs px-1 text-red-400">Rating the replacements failed.</p>}
          {rows === null && <p className="text-xs px-1 text-gray-500 dark:text-gray-300">No setup wears it: a spec, drain or required item.</p>}
          {Array.isArray(rows) && (
            <ol data-testid="replacements">
              {rows.slice(0, REPLACEMENTS_SHOWN).map((r) => (
                <li key={r.id ?? 'empty'} data-testid="replacement-row" className={`${rowClass} ${r.current ? 'bg-orange-100 dark:bg-orange-900/40' : ''}`}>
                  <span className="flex items-center justify-center">{r.id !== null && <ItemImage id={r.id} size={22} />}</span>
                  <span className="truncate">
                    {r.id === null ? 'Nothing' : itemById(r.id)?.name ?? r.id}
                    {r.held && !r.current && <span className="text-gray-500 dark:text-gray-300"> · in the loadout</span>}
                  </span>
                  <span className={`text-right ${r.delta < -0.05 ? 'text-green-600 dark:text-green-400' : ''} ${r.delta > 0.05 ? 'text-red-500 dark:text-red-400' : ''}`}>
                    {r.current ? 'current' : deltaLabel(r.delta)}
                  </span>
                  <span className="text-right text-gray-500 dark:text-gray-300">{r.id === null ? '' : priceLabel(r.id, prices, owned).replace('free (untradeable or no price)', 'free')}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
};

export default ItemDetails;
