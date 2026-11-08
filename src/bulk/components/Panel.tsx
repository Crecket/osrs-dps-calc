import React, { PropsWithChildren } from 'react';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import useStoredFlag from '@/bulk/lib/useStoredFlag';

interface PanelProps {
  title: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
  // keeps the header, and `belowHeader` under it, in view while the panel scrolls past (from the sm breakpoint up)
  stickyHeader?: boolean;
  belowHeader?: React.ReactNode;
  // makes the panel collapsible, remembering it in this browser under this key
  collapseKey?: string;
}

const Panel: React.FC<PropsWithChildren<PanelProps>> = ({
  title, actions, className, stickyHeader, belowHeader, collapseKey, children,
}) => {
  // a key no panel saves under stands for "not collapsible"
  const [collapsed, setCollapsed] = useStoredFlag(collapseKey ?? '');
  const heading = collapseKey ? (
    <button type="button" className="flex items-center gap-2 rounded" aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)}>
      {collapsed ? <IconChevronRight size={18} aria-hidden /> : <IconChevronDown size={18} aria-hidden />}
      {title}
    </button>
  ) : title;
  const header = (
    <div className="px-4 py-2.5 border-b-body-400 bg-body-100 dark:bg-dark-400 dark:border-b-dark-200 border-b sm:rounded-t flex flex-wrap gap-2 justify-between items-center">
      <h2 className="font-serif text-lg tracking-tight font-bold flex items-center gap-2">{heading}</h2>
      {actions && <div className="flex flex-wrap gap-2 items-center text-sm">{actions}</div>}
    </div>
  );
  return (
    <div className={`sm:rounded shadow-lg bg-tile dark:bg-dark-300 text-black dark:text-white flex flex-col ${className || ''}`}>
      {stickyHeader ? (
        // under dropdowns (z-10 and up) of the panels above it, which can open over this one
        <div className="sm:sticky top-0 z-[5] bg-tile dark:bg-dark-300 sm:rounded-t">
          {header}
          {belowHeader}
        </div>
      ) : (
        <>
          {header}
          {belowHeader}
        </>
      )}
      {/* kept mounted: closing a panel doesn't lose what is being typed in it */}
      {collapseKey ? <div className={collapsed ? 'hidden' : undefined}>{children}</div> : children}
    </div>
  );
};

export const buttonClass = 'transition-colors border border-body-500 bg-btns-400 text-white dark:bg-dark-500 dark:border-dark-200 px-2.5 py-1 rounded text-sm hover:bg-btns-300 dark:hover:bg-dark-400 disabled:opacity-50 disabled:cursor-not-allowed';

export const inputClass = 'form-control rounded px-2 py-1 text-sm border border-body-400 dark:border-dark-200 bg-white dark:bg-dark-500 text-black dark:text-white';

export default Panel;
