import React from 'react';
import { usePathname } from 'next/navigation';
import {
  IconCalculator, IconSwords, IconTable, IconTrophy,
} from '@tabler/icons-react';

export const CALC_PATH = '/calc';
export const BEST_PATH = '/best';
export const RAID_PATH = '/raid';

// full page loads in both directions: the calculator's start-up (session restore, storage updater, calc worker) expects
// to run once per page load, and a client-side link would let the browser's back button remount it
export const calculatorHref = () => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${CALC_PATH}`;
const bulkHref = () => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`;
const bestHref = () => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${BEST_PATH}`;
const raidHref = () => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${RAID_PATH}`;

const className = 'transition-all hover:scale-105 no-underline text-white border border-body-500 bg-orange-700 py-1.5 px-2.5 rounded-md dark:border-dark-200 flex items-center gap-1';

/**
 * Rendered from the upstream TopBar; kept here so the upstream file only gains one import and one element.
 */
const BulkNavLink: React.FC = () => {
  const pathname = usePathname();
  const onCalculator = pathname?.startsWith(CALC_PATH);
  const onBest = pathname?.startsWith(BEST_PATH) || pathname?.startsWith(RAID_PATH);

  const back = (
    <a href={bulkHref()} className={className}>
      <IconTable size={20} aria-label="Back to bulk tool" />
      <div className="hidden md:block">Back to bulk tool</div>
    </a>
  );

  if (onBest) return back;

  return (
    <>
      {onCalculator ? back : (
        <a href={calculatorHref()} className={className}>
          <IconCalculator size={20} aria-label="Build setups in the calculator" />
          <div className="hidden md:block">Build setups in the calculator</div>
        </a>
      )}
      <a href={bestHref()} className={className}>
        <IconTrophy size={20} aria-label="Best setup" />
        <div className="hidden md:block">Best setup</div>
      </a>
      <a href={raidHref()} className={className}>
        <IconSwords size={20} aria-label="Raid gear" />
        <div className="hidden md:block">Raid gear</div>
      </a>
    </>
  );
};

export default BulkNavLink;
