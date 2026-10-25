import React, { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { IconX } from '@tabler/icons-react';
import { getCdnImage } from '@/utils';
import { GlobalState, StoreProvider } from '@/state';
import { availableEquipment } from '@/lib/Equipment';
import EquipmentSelect from '@/app/components/player/equipment/EquipmentSelect';
import { bestPool } from '@/best/lib/candidates';
import { EquipmentPiece } from '@/types/Player';
import { useBestStore } from '@/best/state/BestStore';
import { focusRing, Section } from '@/best/components/fields';

let poolIds: Set<number> | null = null;
// only items the search could pick are worth excluding
const inPool = (e: EquipmentPiece) => {
  if (!poolIds) poolIds = new Set(bestPool().map((p) => p.id));
  return poolIds.has(e.id);
};

/** Items the search leaves out: a search box to exclude more, then chips with a remove button, and Clear all. */
const ExcludedItems: React.FC = observer(() => {
  const store = useBestStore();
  const excluded = store.inputs.excludedItemIds ?? [];
  // upstream's item search reads the monster from a calculator store, so give it a scratch one
  const [scratch] = useState(() => new GlobalState());
  const filter = useMemo(() => inPool, []);
  const items = excluded.map((id) => availableEquipment.find((e) => e.id === id)).filter((e): e is EquipmentPiece => e !== undefined);

  return (
    <Section title="Excluded items">
      <p className="text-xs text-gray-500 dark:text-gray-300">
        The search never uses these. Right-click an item in a result to add it here, or search for one.
      </p>
      <div className="max-w-sm">
        <StoreProvider store={scratch}>
          <EquipmentSelect customAvailableEquipmentFilter={filter} onSelectedItemChange={(item) => item && store.excludeItem(item.equipment.id)} />
        </StoreProvider>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {items.map((item) => (
            <span key={item.id} className="flex items-center gap-1 h-7 pl-1 pr-0.5 rounded border border-body-400 dark:border-dark-200 bg-body-100 dark:bg-dark-400 text-xs">
              {item.image && <img className="w-5 h-5 object-contain" src={getCdnImage(`equipment/${item.image}`)} alt="" />}
              {item.name}
              <button
                type="button"
                className={`p-1 rounded text-gray-500 dark:text-gray-300 hover:text-orange-400 dark:hover:text-orange-300 ${focusRing}`}
                aria-label={`Include ${item.name} again`}
                data-tooltip-id="tooltip"
                data-tooltip-content="Include again"
                onClick={() => store.includeItem(item.id)}
              >
                <IconX size={12} />
              </button>
            </span>
          ))}
          {items.length > 1 && (
            <button
              type="button"
              className={`ml-1 text-xs underline text-gray-500 dark:text-gray-300 hover:text-orange-400 dark:hover:text-orange-300 rounded ${focusRing}`}
              onClick={store.clearExcluded}
            >
              Clear all
            </button>
          )}
        </div>
      )}
    </Section>
  );
});

export default ExcludedItems;
