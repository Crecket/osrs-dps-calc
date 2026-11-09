import React, {
  PropsWithChildren, useEffect, useId, useRef, useState,
} from 'react';
import { buttonClass, focusRing, inputClass } from '@/bulk/components/Panel';

const FOCUSABLE = 'input:not(:disabled), button:not(:disabled)';

interface DialogProps {
  title: string;
  submitLabel: string;
  // a destructive action gets a red button
  danger?: boolean;
  canSubmit?: boolean;
  onSubmit: () => void;
  onCancel: () => void;
}

/**
 * A modal dialog: focuses its input or else its submit button, keeps Tab inside, closes on Escape or a click outside it,
 * submits on Enter, and hands the focus back to what had it.
 */
const Dialog: React.FC<PropsWithChildren<DialogProps>> = ({
  title, submitLabel, danger, canSubmit = true, onSubmit, onCancel, children,
}) => {
  const titleId = useId();
  const ref = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const input = ref.current?.querySelector('input');
    if (input) {
      input.focus();
      input.select();
    } else {
      ref.current?.querySelector<HTMLButtonElement>('button[type="submit"]')?.focus();
    }
    return () => opener?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      // popovers listening on the document stay as they are
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Tab' && ref.current) {
      const focusable = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const edge = focusable[e.shiftKey ? 0 : focusable.length - 1];
      if (document.activeElement === edge || document.activeElement === ref.current) {
        e.preventDefault();
        focusable[e.shiftKey ? focusable.length - 1 : 0]?.focus();
      }
    }
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- the backdrop: a mouse shortcut for Cancel and Escape
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      {/* focusable itself, so a click on its text doesn't lose the keyboard */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a dialog handles Escape and Tab */}
      <form
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-sm flex flex-col gap-3 p-4 rounded shadow-xl text-sm text-left font-sans focus:outline-none bg-tile dark:bg-dark-300 border border-body-300 dark:border-dark-200 text-black dark:text-white"
        onKeyDown={onKeyDown}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <h2 id={titleId} className="font-serif text-lg font-bold tracking-tight">{title}</h2>
        {children}
        <div className="flex justify-end gap-2">
          <button type="button" className={`${buttonClass} ${focusRing}`} onClick={onCancel}>Cancel</button>
          <button
            type="submit"
            className={`${buttonClass} ${focusRing} font-bold ${danger ? '!bg-red-400 dark:!bg-red-700' : '!bg-orange-400 dark:!bg-orange-700'}`}
            disabled={!canSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  );
};

/** Asks for a name; a blank one can't be submitted. */
export const PromptDialog: React.FC<{
  title: string;
  label: string;
  initial: string;
  submitLabel: string;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}> = ({
  title, label, initial, submitLabel, onSubmit, onCancel,
}) => {
  const [value, setValue] = useState(initial);
  const trimmed = value.trim();
  return (
    <Dialog title={title} submitLabel={submitLabel} canSubmit={trimmed.length > 0} onSubmit={() => onSubmit(trimmed)} onCancel={onCancel}>
      <input aria-label={label} className={`${inputClass} ${focusRing} w-full`} value={value} onChange={(e) => setValue(e.target.value)} />
    </Dialog>
  );
};

/** Asks to go ahead with something. */
export const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  submitLabel: string;
  onSubmit: () => void;
  onCancel: () => void;
}> = ({
  title, message, submitLabel, onSubmit, onCancel,
}) => (
  <Dialog title={title} submitLabel={submitLabel} danger onSubmit={onSubmit} onCancel={onCancel}>
    <p>{message}</p>
  </Dialog>
);
