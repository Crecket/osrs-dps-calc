import React, { useEffect, useId, useState } from 'react';
import { StaticImageData } from 'next/image';
import scimitarIcon from '@/public/img/bonuses/scimitar.png';
import daggerIcon from '@/public/img/bonuses/dagger.png';
import warhammerIcon from '@/public/img/bonuses/warhammer.png';
import rangedIcon from '@/public/img/bonuses/ranged.png';
import magicIcon from '@/public/img/bonuses/magic.png';
import { inputClass } from '@/bulk/components/Panel';
import { BestStyle } from '@/best/types';

export const styleName = (s: BestStyle) => s.charAt(0).toUpperCase() + s.slice(1);

/** The calculator's own icons for the styles: the stab, slash and crush bonus icons, and the skill icons. */
export const STYLE_ICONS: Record<BestStyle, StaticImageData> = {
  stab: daggerIcon,
  slash: scimitarIcon,
  crush: warhammerIcon,
  ranged: rangedIcon,
  magic: magicIcon,
};

// every control on the page is the same height, with a focus ring that shows on both themes
export const focusRing = 'focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-300 dark:focus-visible:ring-orange-200';
export const fieldClass = `${inputClass} h-8 ${focusRing}`;

/** A section of the inputs: a heading and its rows. */
export const Section: React.FC<React.PropsWithChildren<{ title: string; className?: string }>> = ({ title, className, children }) => (
  <section className={`flex flex-col gap-2 min-w-0 ${className || ''}`}>
    <h3 className="font-serif font-bold">{title}</h3>
    {children}
  </section>
);

/**
 * Label and control columns shared by a section's rows, so labels and controls line up within and across sections.
 * Children place themselves in the two columns, e.g. a FieldLabel and a control. `wide` fits longer labels.
 */
export const FieldGrid: React.FC<React.PropsWithChildren<{ wide?: boolean }>> = ({ wide, children }) => (
  <div className={`grid ${wide ? 'grid-cols-[9.5rem_minmax(0,1fr)]' : 'grid-cols-[7rem_minmax(0,1fr)]'} gap-x-3 gap-y-1.5 items-center`}>{children}</div>
);

export const FieldLabel: React.FC<{ htmlFor?: string; label: string; icon?: StaticImageData }> = ({ htmlFor, label, icon }) => {
  // the icon's space is kept without an icon, so every label's text starts where a checkbox label's does
  const content = (
    <>
      <span className="w-4 shrink-0 flex justify-center">
        {icon && <img className="max-w-4 max-h-4 object-contain" src={icon.src} alt="" />}
      </span>
      <span>{label}</span>
    </>
  );
  return htmlFor
    ? <label htmlFor={htmlFor} className="flex items-center gap-2 text-sm">{content}</label>
    : <span className="flex items-center gap-2 text-sm">{content}</span>;
};

/**
 * A whole-number input in a FieldGrid that only reports values in range, so a half-typed or cleared field doesn't
 * count; it shows the stored value again when it loses focus. With `allowEmpty`, a cleared field reports null.
 */
export const NumberField: React.FC<{
  label: string;
  value: number | null;
  min: number;
  max: number;
  onChange: (v: number | null) => void;
  allowEmpty?: boolean;
  placeholder?: string;
  icon?: StaticImageData;
}> = ({
  label, value, min, max, onChange, allowEmpty, placeholder, icon,
}) => {
  const id = useId();
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);

  return (
    <>
      <FieldLabel htmlFor={id} label={label} icon={icon} />
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className={`${fieldClass} w-16`}
        min={min}
        max={max}
        value={text}
        placeholder={placeholder}
        onChange={(e) => {
          setText(e.target.value);
          if (e.target.value === '') {
            if (allowEmpty) onChange(null);
            return;
          }
          const v = Number(e.target.value);
          if (Number.isInteger(v) && v >= min && v <= max) onChange(v);
        }}
        onBlur={() => setText(value === null ? '' : String(value))}
      />
    </>
  );
};

export const Check: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2 min-h-8 text-sm cursor-pointer">
      <input id={id} type="checkbox" className="w-4 h-4 accent-orange-400 cursor-pointer" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
};
