import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useBestStore } from '@/best/state/BestStore';
import { FieldLabel, fieldClass } from '@/best/components/fields';
import { formatGp, parseGp } from '@/raid/lib/format';

/** The dearest item the search may use, in gp like the raid budget ("50m"); empty is no limit */
const MaxItemPrice: React.FC = observer(() => {
  const store = useBestStore();
  const { maxItemPrice } = store.inputs;
  const show = (gp: number | null | undefined) => (typeof gp === 'number' ? formatGp(gp) : '');
  const [text, setText] = useState(show(maxItemPrice));
  useEffect(() => setText(show(maxItemPrice)), [maxItemPrice]);
  const commit = () => {
    if (text.trim() === '') {
      store.setMaxItemPrice(null);
      return;
    }
    const gp = parseGp(text);
    if (gp !== null) store.setMaxItemPrice(gp);
    else setText(show(maxItemPrice));
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <FieldLabel htmlFor="best-max-item-price" label="Most an item may cost" />
      <input
        id="best-max-item-price"
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
      <span className="text-xs text-gray-500 dark:text-gray-300">e.g. 50m, at the raid page&apos;s prices. It does nothing while prices are unavailable.</span>
    </div>
  );
});

export default MaxItemPrice;
