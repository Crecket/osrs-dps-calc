import React from 'react';
import { IconTrophy } from '@tabler/icons-react';
import { StyleOutcome } from '@/best/lib/run';
import { getCdnImage } from '@/utils';
import { focusRing, STYLE_ICONS, styleName } from '@/best/components/fields';
import { styleSectionId } from '@/best/components/StyleResults';

const bestOf = (o: StyleOutcome) => o.rows.reduce<{ dps: number; i: number } | null>(
  (b, r, i) => (!r.error && (!b || r.dps > b.dps) ? { dps: r.dps, i } : b),
  null,
);

/**
 * Each searched style's best DPS side by side, the strongest marked, each linking to its style's results.
 */
const StyleSummary: React.FC<{ outcomes: StyleOutcome[] }> = ({ outcomes }) => {
  const bests = outcomes.map(bestOf);
  const top = Math.max(...bests.map((b) => b?.dps ?? 0));

  return (
    <nav aria-label="Best per style" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2 p-3 border-b border-body-300 dark:border-dark-200">
      {outcomes.map((o, n) => {
        const b = bests[n];
        const setup = b && o.setups[b.i];
        const weapon = setup?.player.equipment.weapon;
        const isTop = !!b && b.dps === top && top > 0;
        return (
          <a
            key={o.style}
            href={`#${styleSectionId(o)}`}
            className={`no-underline flex flex-col gap-1 min-w-0 px-3 py-2 rounded border transition-colors ${isTop
              ? 'border-orange-300 bg-orange-100/70 dark:bg-orange-500/25 dark:border-orange-300'
              : 'border-body-300 bg-body-100/50 dark:border-dark-200 dark:bg-dark-400/60 hover:border-body-500 dark:hover:border-dark-100'} ${focusRing}`}
          >
            <span className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300">
              <img className="w-4 h-4 object-contain" src={STYLE_ICONS[o.style].src} alt="" />
              {styleName(o.style)}
              {isTop && (
                <span className="ml-auto inline-flex items-center gap-0.5 text-orange-500 dark:text-orange-200 font-semibold">
                  <IconTrophy size={14} aria-hidden />
                  Best
                </span>
              )}
            </span>
            {b && setup ? (
              <>
                <span className="flex items-center gap-2">
                  {weapon?.image && <img className="w-7 h-7 object-contain shrink-0" src={getCdnImage(`equipment/${weapon.image}`)} alt="" />}
                  <span className="text-xl font-bold tabular-nums leading-none">{b.dps.toFixed(3)}</span>
                  <span className="text-xs text-gray-500 dark:text-gray-300">DPS</span>
                </span>
                <span className="text-xs truncate" title={weapon?.name}>{weapon?.name ?? 'Unarmed'}</span>
              </>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-300 py-1">No usable setup</span>
            )}
          </a>
        );
      })}
    </nav>
  );
};

export default StyleSummary;
