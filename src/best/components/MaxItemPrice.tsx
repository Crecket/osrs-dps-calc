import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useBestStore } from '@/best/state/BestStore';
import { FieldLabel, fieldClass } from '@/best/components/fields';
import { formatGp, parseGp } from '@/raid/lib/format';

const show = (gp: number | null | undefined) => (typeof gp === 'number' ? formatGp(gp) : '');

/** An amount in gp like the raid budget ("50m"); empty is no limit. A typo puts the last amount back. */
const GpField: React.FC<{ id: string; label: string; value: number | null | undefined; onCommit: (gp: number | null) => void }> = ({
  id, label, value, onCommit,
}) => {
  const [text, setText] = useState(show(value));
  useEffect(() => setText(show(value)), [value]);
  const commit = () => {
    if (text.trim() === '') {
      onCommit(null);
      return;
    }
    const gp = parseGp(text);
    if (gp !== null) onCommit(gp);
    else setText(show(value));
  };
  return (
    <>
      <FieldLabel htmlFor={id} label={label} />
      <input
        id={id}
        className={`${fieldClass} w-24`}
        type="text"
        inputMode="text"
        placeholder="No limit"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
      />
    </>
  );
};

/** The dearest item the search may use, and the most a whole setup may cost */
const MaxItemPrice: React.FC = observer(() => {
  const store = useBestStore();
  const { maxItemPrice, totalBudget } = store.inputs;
  return (
    <div className="flex flex-col gap-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <GpField id="best-max-item-price" label="Most an item may cost" value={maxItemPrice} onCommit={(gp) => store.setMaxItemPrice(gp)} />
        <GpField id="best-total-budget" label="Most a setup may cost" value={totalBudget} onCommit={(gp) => store.setTotalBudget(gp)} />
      </div>
      <span className="text-xs text-gray-500 dark:text-gray-300">
        e.g. 50m, at the raid page&apos;s prices, weapon included for the setup. They do nothing while prices are unavailable. A setup limit can make the search approximate.
      </span>
    </div>
  );
});

export default MaxItemPrice;
