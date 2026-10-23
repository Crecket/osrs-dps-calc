import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'react-toastify';
import { IconTrash } from '@tabler/icons-react';
import { useBulkStore } from '@/bulk/state/BulkStore';
import { fromCalculatorState, importShortlink, readCalculatorState } from '@/bulk/lib/presetIO';
import { BulkSetup } from '@/bulk/types';
import GearCells from '@/bulk/components/GearCells';
import Panel, { buttonClass, inputClass } from '@/bulk/components/Panel';

const SetupList: React.FC = observer(() => {
  const store = useBulkStore();
  const [link, setLink] = useState('');
  const [loadingLink, setLoadingLink] = useState(false);
  const setups = store.active?.setups || [];

  const importFromCalculator = async (which: 'all' | 'selected') => {
    const state = await readCalculatorState();
    if (!state || !state.loadouts?.length) {
      toast.error('Open the calculator first so there is something to import');
      return;
    }
    let imported: BulkSetup[];
    try {
      ({ setups: imported } = fromCalculatorState(state, which === 'all' ? 'all' : state.selectedLoadout || 0));
    } catch (e) {
      toast.error(`Could not import from the calculator: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    store.addSetups(imported);
    toast.success(`Added ${imported.length} setup${imported.length === 1 ? '' : 's'}`);
  };

  const importLink = async () => {
    if (!link.trim()) return;
    setLoadingLink(true);
    try {
      const { setups: imported } = await importShortlink(link);
      store.addSetups(imported);
      setLink('');
      toast.success(`Added ${imported.length} setup${imported.length === 1 ? '' : 's'}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load that share link');
    } finally {
      setLoadingLink(false);
    }
  };

  return (
    <Panel
      className="grow basis-[560px]"
      title={`Setups (${setups.length})`}
      actions={(
        <>
          <button type="button" className={buttonClass} onClick={() => importFromCalculator('all')}>Add all calculator loadouts</button>
          <button type="button" className={buttonClass} onClick={() => importFromCalculator('selected')}>Add selected loadout</button>
        </>
      )}
    >
      <div className="px-4 py-2 flex gap-2 border-b border-body-200 dark:border-dark-400">
        <input
          className={`${inputClass} grow`}
          placeholder="Paste a DPS calculator share link or ID..."
          value={link}
          onChange={(e) => setLink(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && importLink()}
        />
        <button type="button" className={buttonClass} disabled={loadingLink || !link.trim()} onClick={importLink}>
          {loadingLink ? 'Loading...' : 'Add from link'}
        </button>
      </div>
      <ul className="max-h-[360px] overflow-y-auto">
        {setups.length === 0 && (
          <li className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
            No setups yet. Build loadouts in the calculator, then add them here.
          </li>
        )}
        {setups.map((s) => (
          <li key={s.id} className="px-4 py-1.5 flex gap-2 items-center border-b border-body-200 dark:border-dark-400 last:border-b-0">
            <input
              className={`${inputClass} w-44`}
              aria-label="Setup name"
              defaultValue={s.name}
              onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && store.renameSetup(s.id, e.target.value.trim())}
            />
            <GearCells player={s.player} />
            <button
              type="button"
              aria-label={`Remove ${s.name}`}
              className="ml-auto text-gray-400 hover:text-red-300"
              onClick={() => store.removeSetup(s.id)}
            >
              <IconTrash size={18} />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
});

export default SetupList;
