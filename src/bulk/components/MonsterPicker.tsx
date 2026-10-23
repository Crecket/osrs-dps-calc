import React, { useMemo } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'react-toastify';
import { IconX } from '@tabler/icons-react';
import Combobox from '@/app/components/generic/Combobox';
import { getMonsters } from '@/lib/Monsters';
import { useBulkStore } from '@/bulk/state/BulkStore';
import { fromCalculatorState, monsterFromSearch, readCalculatorState } from '@/bulk/lib/presetIO';
import { monsterLabel, summarizeInputs } from '@/bulk/lib/format';
import Panel, { buttonClass } from '@/bulk/components/Panel';

interface MonsterOption {
  label: string;
  value: number;
  version: string;
}

const allMonsters = getMonsters();

const MonsterPicker: React.FC = observer(() => {
  const store = useBulkStore();
  const target = store.active?.monster || null;

  const options: MonsterOption[] = useMemo(() => allMonsters.map((m, i) => ({
    label: m.name,
    value: i,
    version: m.version || '',
  })), []);

  const importCalculatorMonster = async () => {
    const state = await readCalculatorState();
    if (!state?.monster) {
      toast.error('Open the calculator first so there is something to import');
      return;
    }
    try {
      store.setMonster(fromCalculatorState({ ...state, loadouts: [] }, 'all').monster);
    } catch (e) {
      toast.error(`Could not import from the calculator: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const summary = target ? summarizeInputs(target.monster) : [];

  return (
    <Panel
      className="grow basis-[360px]"
      title="Target monster"
      actions={<button type="button" className={buttonClass} onClick={importCalculatorMonster}>Use calculator&apos;s monster</button>}
    >
      <div className="px-4 py-3 flex flex-col gap-2">
        <Combobox<MonsterOption>
          id="bulk-monster-select"
          className="w-full"
          items={options}
          placeholder={target ? 'Search for a different monster...' : 'Search for a monster...'}
          resetAfterSelect
          onSelectedItemChange={(item) => {
            if (item) store.setMonster(monsterFromSearch(allMonsters[item.value]));
          }}
          CustomItemComponent={({ item }) => (
            <div>
              {item.label}
              {item.version && (
                <span className="monster-version text-xs text-gray-400 dark:text-gray-300">
                  #
                  {item.version}
                </span>
              )}
            </div>
          )}
        />
        {target ? (
          <div className="flex items-center gap-2 text-lg">
            <span className="font-bold">{monsterLabel(target)}</span>
            {summary.length > 0 && <span className="text-xs text-gray-500 dark:text-gray-300">{summary.join(', ')}</span>}
            <button type="button" aria-label="Clear target monster" className="ml-auto text-gray-400 hover:text-red-300" onClick={() => store.setMonster(null)}>
              <IconX size={18} />
            </button>
          </div>
        ) : (
          <p className="text-sm text-gray-500 dark:text-gray-300">Pick the monster to compare your setups against.</p>
        )}
        <p className="text-xs text-gray-500 dark:text-gray-300">
          For raids, phases or defence reductions, set the monster up in the calculator and use &quot;Use calculator&apos;s monster&quot;.
        </p>
      </div>
    </Panel>
  );
});

export default MonsterPicker;
