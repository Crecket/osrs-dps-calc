import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { BestStyle } from '@/best/types';
import { RaidResult, WeaponTier } from '@/raid/lib/runRaid';
import { formatGp, formatTime } from '@/raid/lib/format';
import {
  ItemImage, ItemMenu, itemById, useItemMenu,
} from '@/raid/components/items';
import { focusRing } from '@/best/components/fields';
import { DEFENCE_WEAPON_IDS, DEFENCE_WEAPONS, PhasePart } from '@/raid/types';

// spec weapons shown per phase, best spec damage per second first
const SPECS_SHOWN = 3;

const MELEE: BestStyle[] = ['stab', 'slash', 'crush'];
const partStyles = ({ styles }: PhasePart) => {
  if (!styles) return 'any style';
  if (styles.length === MELEE.length && MELEE.every((st) => styles.includes(st))) return 'melee';
  return styles.join('/');
};
/** e.g. "50% ranged · 50% any style" */
const partsLabel = (parts: PhasePart[]) => parts.map((p) => `${Math.round(p.share * 100)}% ${partStyles(p)}`).join(' · ');

type Group = 'melee' | 'ranged' | 'magic';
const groupOf = (style: BestStyle): Group => (style === 'ranged' || style === 'magic' ? style : 'melee');

// tiers by DPS against the best of the list
const TIERS: [string, number, string][] = [
  ['S', 0.95, 'bg-green-600 text-white'],
  ['A', 0.85, 'bg-lime-600 text-white'],
  ['B', 0.75, 'bg-yellow-500 text-black'],
  ['C', 0.6, 'bg-orange-500 text-white'],
  ['D', 0, 'bg-red-600 text-white'],
];
const TIER_SHOWN = 15;

/** The phase's weapons of one style group, fastest first, tiered against the fastest */
const TierList: React.FC<{ tiers: WeaponTier[]; weaponId: number; title: string }> = ({ tiers, weaponId, title }) => {
  const best = tiers[0]?.dps ?? 0;
  return (
    <div data-testid="tier-list" className="md:col-span-3 rounded border border-body-300 dark:border-dark-200 bg-body-100/60 dark:bg-dark-500/60 p-2">
      <h5 className="text-xs font-semibold px-1 pb-1.5">{title}</h5>
      {tiers.length === 0 && <p className="text-xs text-gray-500 dark:text-gray-300 px-1">No searched weapons of this style here.</p>}
      <ol className="flex flex-col">
        {tiers.slice(0, TIER_SHOWN).map((t) => {
          const [letter, , color] = TIERS.find(([, min]) => t.dps >= best * min)!;
          return (
            <li
              key={t.weaponId}
              data-testid="tier-row"
              className={`grid grid-cols-[1.5rem_1.75rem_minmax(0,1fr)_4rem_3.5rem_4.5rem_5rem] items-center gap-2 px-1 py-1 rounded text-xs tabular-nums ${t.weaponId === weaponId ? 'bg-orange-100 dark:bg-orange-900/40' : ''}`}
            >
              <span className={`w-5 h-5 rounded flex items-center justify-center font-bold ${color}`}>{letter}</span>
              <span className="flex items-center justify-center"><ItemImage id={t.weaponId} size={24} /></span>
              <span className="truncate">{itemById(t.weaponId)?.name ?? t.weaponId}</span>
              <span className="text-right">{t.dps.toFixed(2)}</span>
              <span className="text-right">{formatTime(t.seconds)}</span>
              <span className="text-right text-gray-500 dark:text-gray-300">{t.cost > 0 ? formatGp(t.cost) : 'free'}</span>
              <span className="text-green-700 dark:text-green-300">{t.held ? 'in loadout' : ''}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
};

interface Cell {
  weaponId: number;
  dps: number;
  seconds: number;
  /** Which part of the phase the weapon deals, on a split phase */
  part?: string;
}

// every phase row uses the same columns, so cells line up down the whole list
const ROW = 'grid grid-cols-1 md:grid-cols-[9rem_minmax(0,1fr)_14.5rem] gap-x-4 gap-y-2 items-start';
const CELL = 'w-[4.5rem] flex flex-col items-center gap-0.5 rounded px-1 py-1.5 text-xs tabular-nums';

/** GearScape-style rows: per phase the weapons the loadout uses (one per part of a split phase), the other weapons it can use, and the best specs */
const BossResults: React.FC<{ result: RaidResult }> = observer(({ result }) => {
  const menu = useItemMenu();
  // the weapon whose tier list is open, on its phase
  const [open, setOpen] = useState<{ key: string; weaponId: number } | null>(null);
  const bosses = [...new Map(result.phases.map((p) => [p.bossId, p.bossName])).entries()];
  // a result saved before specs were ranked by damage per second has no dps; it shows no specs until the next run
  const specsOf = (key: string) => (result.specs?.[key] ?? []).filter((sp) => typeof sp.dps === 'number');
  // a phase with parts has a pick per part
  const pickSeconds = new Map<string, number>();
  result.plan.picks.forEach((p) => pickSeconds.set(p.key, (pickSeconds.get(p.key) ?? 0) + p.seconds));

  const usedOf = (key: string, parts?: PhasePart[]): Cell[] => result.plan.picks.filter((p) => p.key === key).flatMap((p, i) => {
    const weaponId = p.candidate?.setup.player.equipment.weapon?.id;
    if (weaponId === undefined) return [];
    const part = parts?.[i];
    return [{
      weaponId, dps: p.seconds > 0 ? p.hp / p.seconds : 0, seconds: p.seconds, part: part ? `${Math.round(part.share * 100)}% ${partStyles(part)}` : undefined,
    }];
  });

  const weaponCell = (key: string, c: Cell, kind: 'used' | 'option') => {
    const expanded = open?.key === key && open.weaponId === c.weaponId;
    return (
      <button
        type="button"
        key={`${c.weaponId}-${c.part ?? ''}`}
        data-testid={`${kind}-cell`}
        aria-label={`${itemById(c.weaponId)?.name ?? c.weaponId}: show other options`}
        aria-expanded={expanded}
        className={`${CELL} ${focusRing} ${expanded ? 'ring-2 ring-orange-400' : ''} ${kind === 'used'
          ? 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 font-semibold'
          : 'bg-body-100 dark:bg-dark-400 hover:bg-body-200 dark:hover:bg-dark-300'}`}
        data-tooltip-id="tooltip"
        data-tooltip-content={itemById(c.weaponId)?.name}
        onClick={() => setOpen(expanded ? null : { key, weaponId: c.weaponId })}
        onContextMenu={menu.open(c.weaponId)}
      >
        <span className="w-9 h-9 flex items-center justify-center"><ItemImage id={c.weaponId} /></span>
        <span>{c.dps.toFixed(2)}</span>
        <span className="font-normal">{formatTime(c.seconds)}</span>
        {c.part && <span className="font-normal text-[10px] leading-tight text-center text-gray-600 dark:text-gray-300">{c.part}</span>}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className={`${ROW} hidden md:grid px-3 text-xs text-gray-500 dark:text-gray-300`} aria-hidden>
        <span>Phase</span>
        <span>Weapons: used, then other options (DPS, kill time)</span>
        <span>Best specs (spec DPS)</span>
      </div>
      {bosses.map(([bossId, bossName]) => {
        const phases = result.phases.filter((p) => p.bossId === bossId);
        const seconds = phases.reduce((n, p) => n + (pickSeconds.get(p.key) ?? 0), 0);
        return (
          <section key={bossId} className="rounded border border-body-300 dark:border-dark-200" data-testid="boss-row">
            <header className="flex items-baseline justify-between gap-3 px-3 py-2 border-b border-body-300 dark:border-dark-200 bg-body-100/60 dark:bg-dark-500/60">
              <strong className="font-serif text-sm">{bossName}</strong>
              <span className="tabular-nums text-sm text-gray-500 dark:text-gray-300">{formatTime(seconds)}</span>
            </header>
            <div className="flex flex-col divide-y divide-body-300 dark:divide-dark-200">
              {phases.map((p) => {
                const used = usedOf(p.key, p.parts);
                const usedIds = new Set(used.map((c) => c.weaponId));
                const others = (result.options[p.key] ?? []).filter((o) => !usedIds.has(o.weaponId));
                const specs = specsOf(p.key).slice(0, SPECS_SHOWN);
                return (
                  <div key={p.key} className={`${ROW} px-3 py-2.5`}>
                    <div className="text-xs flex flex-col gap-1 pt-1">
                      <span className="font-semibold">{p.label}</span>
                      {p.parts && <span className="text-gray-500 dark:text-gray-300">{partsLabel(p.parts)}</span>}
                      {DEFENCE_WEAPONS.some((w) => p.counts[w] > 0) && (
                        <span className="flex gap-1.5">
                          {DEFENCE_WEAPONS.filter((w) => p.counts[w] > 0).map((w) => (
                            <span key={w} className="flex items-center gap-0.5">
                              <ItemImage id={DEFENCE_WEAPON_IDS[w]} size={16} />
                              <span className="tabular-nums">{p.counts[w]}</span>
                            </span>
                          ))}
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-start gap-1.5">
                      {used.map((c) => weaponCell(p.key, c, 'used'))}
                      {used.length > 0 && others.length > 0 && <span className="self-stretch w-px mx-1 bg-body-300 dark:bg-dark-200" aria-hidden />}
                      {others.map((o) => weaponCell(p.key, o, 'option'))}
                      {used.length === 0 && others.length === 0 && <span className="text-xs text-gray-500 dark:text-gray-300 pt-1">No usable setup</span>}
                    </div>
                    <div className="flex flex-wrap items-start gap-1.5">
                      {specs.map((sp) => (
                        <div
                          key={sp.weaponId}
                          data-testid="spec-cell"
                          className={`${CELL} bg-body-100 dark:bg-dark-400`}
                          data-tooltip-id="tooltip"
                          data-tooltip-content={`${itemById(sp.weaponId)?.name}: ${sp.expected.toFixed(1)} expected per ${sp.cost}% spec, ${sp.dps.toFixed(2)} damage per second`}
                          onContextMenu={menu.open(sp.weaponId)}
                        >
                          <span className="w-9 h-9 flex items-center justify-center"><ItemImage id={sp.weaponId} /></span>
                          <span>{`${sp.dps.toFixed(2)} dps`}</span>
                          <span className="text-gray-500 dark:text-gray-300">{`${sp.cost}%`}</span>
                        </div>
                      ))}
                      {specs.length === 0 && <span className="text-xs text-gray-500 dark:text-gray-300 pt-1">—</span>}
                    </div>
                    {open?.key === p.key && (() => {
                      const tiers = result.tiers?.[p.key] ?? [];
                      const style = tiers.find((t) => t.weaponId === open.weaponId)?.style ?? null;
                      const group = style ? groupOf(style) : null;
                      return (
                        <TierList
                          tiers={group ? tiers.filter((t) => groupOf(t.style) === group) : []}
                          weaponId={open.weaponId}
                          title={group ? `${group[0].toUpperCase()}${group.slice(1)} weapons on ${p.label}, fastest first` : 'Run again to see the other options'}
                        />
                      );
                    })()}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
      <ItemMenu target={menu.target} onClose={menu.close} />
    </div>
  );
});

export default BossResults;
