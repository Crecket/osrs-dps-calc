import React, { useEffect, useState } from 'react';
import { IconChevronDown, IconChevronRight, IconX } from '@tabler/icons-react';
import { getCanonicalItemId } from '@/lib/Equipment';
import { RaidResult } from '@/raid/lib/runRaid';
import { Replacement } from '@/raid/lib/itemValue';
import { Prices } from '@/raid/lib/prices';
import { formatTime } from '@/raid/lib/format';
import {
  BossImage, ItemImage, itemById, priceLabel,
} from '@/raid/components/items';

const REPLACEMENTS_SHOWN = 10;
const WEAPONS_SHOWN = 10;
const WHOLE_RAID = 'raid';

/** "+3.2s" slower, "−1.0s" faster */
export const deltaLabel = (seconds: number) => `${seconds > 0 ? '+' : '−'}${Math.abs(seconds).toFixed(1)}s`;

const rowClass = 'grid grid-cols-[1.75rem_minmax(0,1fr)_4rem_4.5rem] items-center gap-2 px-1 py-1 rounded text-xs tabular-nums';
const bossOf = (key: string) => key.split(':')[0];

const BossTitle: React.FC<{ id: string; name: string }> = ({ id, name }) => (
  <>
    <BossImage bossId={id} size={18} />
    <span className="truncate">{name}</span>
  </>
);

/** A section that folds; the panel keeps one open at a time */
const Fold: React.FC<{
  title: React.ReactNode; summary?: string; open: boolean; onToggle: () => void; children: React.ReactNode;
}> = ({
  title, summary, open, onToggle, children,
}) => (
  <div className="rounded border border-body-200 dark:border-dark-300">
    <button type="button" aria-expanded={open} className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-body-200 dark:hover:bg-dark-400" onClick={onToggle}>
      {open ? <IconChevronDown size={14} aria-hidden /> : <IconChevronRight size={14} aria-hidden />}
      <span className="grow min-w-0 flex items-center gap-2 font-semibold truncate">{title}</span>
      {summary && <span className="shrink-0 text-gray-500 dark:text-gray-300 tabular-nums">{summary}</span>}
    </button>
    {open && <div className="px-1 pb-1">{children}</div>}
  </div>
);

/**
 * An item of the loadout: what it saves, and what else could stand in its slot, for the whole raid and per boss, each
 * folded. A weapon shows the fastest weapons of each boss it is used on instead.
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
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    setOpen(isWeapon ? bossOf(weaponPicks[0].key) : WHOLE_RAID);
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
    // the picks follow the id
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, isWeapon, load]);

  const toggle = (key: string) => () => setOpen((o) => (o === key ? null : key));
  // the bosses in route order, with their phases
  const bosses = result.phases.filter((p, i) => result.phases.findIndex((q) => q.bossId === p.bossId) === i)
    .map((p) => ({ id: p.bossId, name: p.bossName }));
  const phaseLabel = (key: string) => result.phases.find((x) => x.key === key)?.label ?? key;
  const priceText = (x: number) => priceLabel(x, prices, owned).replace('free (untradeable or no price)', 'free');

  const replacementList = (list: Replacement[], delta: (r: Replacement) => number) => (
    <ol data-testid="replacements">
      {list.filter((r) => Number.isFinite(delta(r))).sort((a, b) => delta(a) - delta(b) || a.price - b.price).slice(0, REPLACEMENTS_SHOWN)
        .map((r) => {
          const d = delta(r);
          return (
            <li key={r.id ?? 'empty'} data-testid="replacement-row" className={`${rowClass} ${r.current ? 'bg-orange-100 dark:bg-orange-900/40' : ''}`}>
              <span className="flex items-center justify-center">{r.id !== null && <ItemImage id={r.id} size={22} />}</span>
              <span className="truncate">
                {r.id === null ? 'Nothing' : itemById(r.id)?.name ?? r.id}
                {r.held && !r.current && <span className="text-gray-500 dark:text-gray-300"> · in the loadout</span>}
              </span>
              <span className={`text-right ${d < -0.05 ? 'text-green-600 dark:text-green-400' : ''} ${d > 0.05 ? 'text-red-500 dark:text-red-400' : ''}`}>
                {r.current ? 'current' : deltaLabel(d)}
              </span>
              <span className="text-right text-gray-500 dark:text-gray-300">{r.id === null ? '' : priceText(r.id)}</span>
            </li>
          );
        })}
    </ol>
  );
  // the fastest the scope could get, for its folded header
  const bestSummary = (list: Replacement[], delta: (r: Replacement) => number) => {
    const best = list.filter((r) => !r.current && Number.isFinite(delta(r))).sort((a, b) => delta(a) - delta(b))[0];
    return best && delta(best) < -0.05 ? `best ${deltaLabel(delta(best))}` : 'nothing faster';
  };

  return (
    <section data-testid="item-details" className="rounded border border-body-300 dark:border-dark-200 bg-body-100/60 dark:bg-dark-500/60 p-2 flex flex-col gap-2 max-h-[60vh] min-h-0">
      <header className="flex items-center gap-2 shrink-0">
        <ItemImage id={id} size={28} />
        <div className="grow min-w-0">
          <h3 className="text-sm font-bold truncate">{item?.name ?? id}</h3>
          <p className="text-xs text-gray-500 dark:text-gray-300">{priceLabel(id, prices, owned)}</p>
        </div>
        <button type="button" aria-label="Close" className="p-1 rounded hover:bg-body-200 dark:hover:bg-dark-400" onClick={onClose}>
          <IconX size={16} aria-hidden />
        </button>
      </header>
      <div className="flex flex-col gap-1 overflow-y-auto min-h-0">
        {isWeapon && bosses.filter((b) => weaponPicks.some((p) => bossOf(p.key) === b.id)).map((b) => {
          const keys = [...new Set(weaponPicks.filter((p) => bossOf(p.key) === b.id).map((p) => p.key))];
          return (
            <Fold key={b.id} title={<BossTitle id={b.id} name={b.name} />} open={open === b.id} onToggle={toggle(b.id)}>
              {keys.map((key) => {
                const tiers = result.tiers?.[key] ?? [];
                return (
                  <div key={key}>
                    <h4 className="text-xs text-gray-500 dark:text-gray-300 px-1 py-1">{`${phaseLabel(key)}: fastest weapons`}</h4>
                    {tiers.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-300 px-1">Run again to see the other weapons.</p>}
                    <ol>
                      {tiers.slice(0, WEAPONS_SHOWN).map((t) => (
                        <li key={`${t.weaponId}-${t.style}`} className={`${rowClass} ${getCanonicalItemId(t.weaponId) === canonical ? 'bg-orange-100 dark:bg-orange-900/40' : ''}`}>
                          <span className="flex items-center justify-center"><ItemImage id={t.weaponId} size={22} /></span>
                          <span className="truncate">{itemById(t.weaponId)?.name ?? t.weaponId}</span>
                          <span className="text-right">{formatTime(t.seconds)}</span>
                          <span className="text-right text-gray-500 dark:text-gray-300">{priceText(t.weaponId)}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                );
              })}
            </Fold>
          );
        })}
        {!isWeapon && rows === 'loading' && <p className="text-xs px-1">Rating replacements…</p>}
        {!isWeapon && rows === 'failed' && <p className="text-xs px-1 text-red-400">Rating the replacements failed.</p>}
        {!isWeapon && rows === null && <p className="text-xs px-1 text-gray-500 dark:text-gray-300">No setup wears it: a spec, drain or required item.</p>}
        {!isWeapon && Array.isArray(rows) && (
          <>
            <Fold title="Whole raid" summary={bestSummary(rows, (r) => r.delta)} open={open === WHOLE_RAID} onToggle={toggle(WHOLE_RAID)}>
              {replacementList(rows, (r) => r.delta)}
            </Fold>
            {bosses.filter((b) => rows[0]?.byBoss[b.id] !== undefined).map((b) => {
              const delta = (r: Replacement) => r.byBoss[b.id] ?? Infinity;
              return (
                <Fold key={b.id} title={<BossTitle id={b.id} name={b.name} />} summary={bestSummary(rows, delta)} open={open === b.id} onToggle={toggle(b.id)}>
                  {replacementList(rows, delta)}
                </Fold>
              );
            })}
          </>
        )}
      </div>
    </section>
  );
};

export default ItemDetails;
