import React, { PropsWithChildren } from 'react';
import { IconAlertTriangle, IconX } from '@tabler/icons-react';
import useStoredFlag from '@/bulk/lib/useStoredFlag';

/** A note above a page that stays closed in this browser once closed */
const DismissibleNote: React.FC<PropsWithChildren<{ storageKey: string }>> = ({ storageKey, children }) => {
  const [dismissed, setDismissed] = useStoredFlag(storageKey);
  if (dismissed) return null;
  return (
    <div role="note" className="flex items-start gap-2 px-4 py-2 rounded bg-orange-100 dark:bg-orange-500/60 text-orange-500 dark:text-orange-100 text-sm border border-orange-200 dark:border-orange-400">
      <IconAlertTriangle size={18} className="shrink-0 mt-px" aria-hidden />
      <span className="grow">{children}</span>
      <button type="button" aria-label="Dismiss" className="shrink-0 rounded hover:opacity-70" onClick={() => setDismissed(true)}>
        <IconX size={18} aria-hidden />
      </button>
    </div>
  );
};

export default DismissibleNote;
