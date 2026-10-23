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

const MonsterList: React.FC = observer(() => {
  const store = useBulkStore();
  const monsters = store.active?.monsters || [];

  const options: MonsterOption[] = useMemo(() => allMonsters.map((m, i) => ({
    label: m.name,
    value: i,
    version: m.version || '',
  })), []);

  const addCurrent = async () => {
    const state = await readCalculatorState();
    if (!state?.monster) {
      toast.error('Open the calculator first so there is something to import');
      return;
    }
    try {
      store.addMonster(fromCalculatorState({ ...state, loadouts: [] }, 'all').monster);
    } catch (e) {
      toast.error(`Could not import from the calculator: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <Panel
      className="grow basis-[360px]"
      title={`Monsters (${monsters.length})`}
      actions={<button type="button" className={buttonClass} onClick={addCurrent}>Add calculator&apos;s monster</button>}
    >
      <div className="px-4 py-2 border-b border-body-200 dark:border-dark-400">
        <Combobox<MonsterOption>
          id="bulk-monster-select"
          className="w-full"
          items={options}
          placeholder="Search for monster to add..."
          resetAfterSelect
          keepOpenAfterSelect
          onSelectedItemChange={(item) => {
            if (item) store.addMonster(monsterFromSearch(allMonsters[item.value]));
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
        <p className="text-xs mt-1 text-gray-500 dark:text-gray-300">
          For raids, phases or defence reductions, set the monster up in the calculator and use &quot;Add calculator&apos;s monster&quot;.
        </p>
      </div>
      <div className="px-4 py-2 flex flex-wrap gap-1.5 max-h-[300px] overflow-y-auto">
        {monsters.length === 0 && <p className="text-sm text-gray-500 dark:text-gray-300 py-2">No monsters yet.</p>}
        {monsters.map((m) => {
          const summary = summarizeInputs(m.monster);
          return (
            <span key={m.id} className="inline-flex items-center gap-1 rounded-full pl-3 pr-1.5 py-0.5 text-sm bg-body-100 dark:bg-dark-400 border border-body-300 dark:border-dark-200">
              <span className="font-semibold">{monsterLabel(m)}</span>
              {summary.length > 0 && <span className="text-xs text-gray-500 dark:text-gray-300">{summary.join(', ')}</span>}
              <button type="button" aria-label={`Remove ${monsterLabel(m)}`} className="text-gray-400 hover:text-red-300" onClick={() => store.removeMonster(m.id)}>
                <IconX size={14} />
              </button>
            </span>
          );
        })}
      </div>
    </Panel>
  );
});

export default MonsterList;
