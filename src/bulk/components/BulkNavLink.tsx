import React from 'react';
import { usePathname } from 'next/navigation';
import { IconCalculator, IconTable } from '@tabler/icons-react';

export const CALC_PATH = '/calc';

// full page loads in both directions: the calculator's start-up (session restore, storage updater, calc worker) expects
// to run once per page load, and a client-side link would let the browser's back button remount it
export const calculatorHref = () => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}${CALC_PATH}`;
const bulkHref = () => `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`;

const className = 'transition-all hover:scale-105 no-underline text-white border border-body-500 bg-orange-700 py-1.5 px-2.5 rounded-md dark:border-dark-200 flex items-center gap-1';

/**
 * Rendered from the upstream TopBar; kept here so the upstream file only gains one import and one element.
 */
const BulkNavLink: React.FC = () => {
  const onCalculator = usePathname()?.startsWith(CALC_PATH);

  if (onCalculator) {
    return (
      <a href={bulkHref()} className={className}>
        <IconTable size={20} aria-label="Back to bulk tool" />
        <div className="hidden md:block">Back to bulk tool</div>
      </a>
    );
  }

  return (
    <a href={calculatorHref()} className={className}>
      <IconCalculator size={20} aria-label="Build setups in the calculator" />
      <div className="hidden md:block">Build setups in the calculator</div>
    </a>
  );
};

export default BulkNavLink;
