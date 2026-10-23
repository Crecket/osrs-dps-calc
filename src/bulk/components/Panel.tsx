import React, { PropsWithChildren } from 'react';

const Panel: React.FC<PropsWithChildren<{ title: React.ReactNode; actions?: React.ReactNode; className?: string }>> = ({
  title, actions, className, children,
}) => (
  <div className={`sm:rounded shadow-lg bg-tile dark:bg-dark-300 text-black dark:text-white flex flex-col ${className || ''}`}>
    <div className="px-4 py-2.5 border-b-body-400 bg-body-100 dark:bg-dark-400 dark:border-b-dark-200 border-b sm:rounded-t flex flex-wrap gap-2 justify-between items-center">
      <h2 className="font-serif text-lg tracking-tight font-bold flex items-center gap-2">{title}</h2>
      {actions && <div className="flex flex-wrap gap-2 items-center text-sm">{actions}</div>}
    </div>
    {children}
  </div>
);

export const buttonClass = 'transition-colors border border-body-500 bg-btns-400 text-white dark:bg-dark-500 dark:border-dark-200 px-2.5 py-1 rounded text-sm hover:bg-btns-300 dark:hover:bg-dark-400 disabled:opacity-50 disabled:cursor-not-allowed';

export const inputClass = 'form-control rounded px-2 py-1 text-sm border border-body-400 dark:border-dark-200 bg-white dark:bg-dark-500 text-black dark:text-white';

export default Panel;
