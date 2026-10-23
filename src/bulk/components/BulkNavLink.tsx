import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { IconCalculator, IconTable } from '@tabler/icons-react';

/**
 * Rendered from the upstream TopBar; kept here so the upstream file only gains one import and one element.
 */
const className = 'transition-all hover:scale-105 no-underline text-white border border-body-500 bg-orange-700 py-1.5 px-2.5 rounded-md dark:border-dark-200 flex items-center gap-1';

const BulkNavLink: React.FC = () => {
  const onBulk = usePathname()?.startsWith('/bulk');

  if (onBulk) {
    // a full page load: the calculator's start-up (session restore, storage updater, calc worker) expects to run once
    return (
      <a href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/`} className={className}>
        <IconCalculator size={20} aria-label="Calculator" />
        <div className="hidden md:block">Calculator</div>
      </a>
    );
  }

  return (
    <Link href="/bulk" className={className}>
      <IconTable size={20} aria-label="Bulk mode" />
      <div className="hidden md:block">Bulk mode</div>
    </Link>
  );
};

export default BulkNavLink;
