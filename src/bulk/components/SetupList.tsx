import React, { useCallback, useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'react-toastify';
import {
  IconCopy, IconPencil, IconPlus, IconTrash, IconX,
} from '@tabler/icons-react';
import { useBulkStore } from '@/bulk/state/BulkStore';
import { fromCalculatorState, importShortlink, readCalculatorState } from '@/bulk/lib/presetIO';
import { BulkSetup } from '@/bulk/types';
import { addResultMessage, sortSetups } from '@/bulk/lib/format';
import StyleLabel from '@/bulk/components/StyleLabel';
import { hasGear, newCalculatorSetups } from '@/bulk/lib/calculatorLoadouts';
import { setupKey } from '@/bulk/lib/dedupe';
import GearCells from '@/bulk/components/GearCells';
import SetupQuickEdit, { QuickEditKind } from '@/bulk/components/SetupQuickEdit';
import SetupEditor from '@/bulk/components/SetupEditor';
import Panel, { buttonClass, inputClass } from '@/bulk/components/Panel';

export const notifyAdded = (result: { added: number; skipped: number }) => {
  const message = addResultMessage(result);
  if (result.added > 0) toast.success(message);
  else toast.info(message);
};

const SetupList: React.FC = observer(() => {
  const store = useBulkStore();
  const [link, setLink] = useState('');
  const [loadingLink, setLoadingLink] = useState(false);
  // the setup open in the full editor, if any
  const [editingId, setEditingId] = useState<string | null>(null);
  // the setup made by New setup, so pressing it again closes that editor instead of making another
  const [newSetupId, setNewSetupId] = useState<string | null>(null);
  const closeEditor = () => {
    if (editingId !== null && editingId === newSetupId) store.discardIfBlank(editingId);
    setEditingId(null);
    setNewSetupId(null);
  };
  const openNewSetup = () => {
    if (editingId !== null && editingId === newSetupId) store.discardIfBlank(editingId);
    const created = store.createSetup();
    setNewSetupId(created.id);
    setEditingId(created.id);
  };
  // one quick-edit popover open at a time
  const [quickEdit, setQuickEdit] = useState<{ id: string; kind: QuickEditKind } | null>(null);
  const setups = store.active?.setups || [];
  const setupIds = setups.map((s) => s.id).join(',');

  // the calculator's loadouts that aren't in this preset yet, offered in a banner after building one there
  const [fromCalc, setFromCalc] = useState<BulkSetup[]>([]);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const fromCalcKey = fromCalc.map((s) => setupKey(s.player)).join('|');

  const refreshFromCalc = useCallback(async () => {
    const existing = store.active?.setups || [];
    setFromCalc(newCalculatorSetups(await readCalculatorState().catch(() => null), existing));
  }, [store]);

  useEffect(() => {
    refreshFromCalc();
    window.addEventListener('focus', refreshFromCalc);
    return () => window.removeEventListener('focus', refreshFromCalc);
  }, [refreshFromCalc, setupIds, store.activeId]);

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
    imported = imported.filter((x) => hasGear(x.player));
    if (imported.length === 0) {
      toast.info('The calculator has no loadouts with gear yet');
      return;
    }
    notifyAdded(store.addSetups(imported));
  };

  const importLink = async () => {
    if (!link.trim()) return;
    setLoadingLink(true);
    try {
      const { setups: imported } = await importShortlink(link);
      notifyAdded(store.addSetups(imported));
      setLink('');
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
          <button
            type="button"
            className={`${buttonClass} !bg-orange-400 dark:!bg-orange-700 font-bold`}
            onClick={() => (editingId !== null && editingId === newSetupId ? closeEditor() : openNewSetup())}
          >
            <span className="flex items-center gap-1">
              <IconPlus size={16} />
              {' '}
              New setup
            </span>
          </button>
          <button type="button" className={buttonClass} onClick={() => importFromCalculator('all')}>Add all calculator loadouts</button>
          <button type="button" className={buttonClass} onClick={() => importFromCalculator('selected')}>Add selected loadout</button>
          <button type="button" className={buttonClass} onClick={() => notifyAdded(store.addDefaultSetups())}>Add max setups</button>
        </>
      )}
    >
      {fromCalc.length > 0 && dismissed !== fromCalcKey && (
        <div className="px-4 py-2 text-sm flex items-center gap-2 bg-orange-500 text-white">
          <span>{`${fromCalc.length} calculator loadout${fromCalc.length === 1 ? " isn't" : "s aren't"} in this preset`}</span>
          <button type="button" className="font-bold underline" onClick={() => notifyAdded(store.addSetups(fromCalc))}>
            Add them
          </button>
          <button type="button" aria-label="Dismiss" className="ml-auto" onClick={() => setDismissed(fromCalcKey)}>
            <IconX size={16} />
          </button>
        </div>
      )}
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
      {/* the results below stay full height; only the setups scroll */}
      <ul className="max-h-[800px] overflow-y-auto">
        {setups.length === 0 && (
          <li className="px-4 py-4 text-sm text-gray-500 dark:text-gray-300">
            No setups yet. Click New setup, or add loadouts from the calculator.
          </li>
        )}
        {sortSetups(setups).map((s) => (
          <React.Fragment key={s.id}>
            <li className="px-4 py-1.5 flex gap-2 items-center border-b border-body-200 dark:border-dark-400 last:border-b-0">
              <input
                className={`${inputClass} w-44`}
                aria-label="Setup name"
                defaultValue={s.name}
                onBlur={(e) => e.target.value.trim() && e.target.value !== s.name && store.renameSetup(s.id, e.target.value.trim())}
              />
              <StyleLabel player={s.player} className="w-24 shrink-0" />
              <GearCells player={s.player} />
              <SetupQuickEdit setup={s} open={quickEdit?.id === s.id ? quickEdit.kind : null} onOpen={(kind) => setQuickEdit(kind ? { id: s.id, kind } : null)} />
              <button
                type="button"
                aria-label={`Edit ${s.name}`}
                className={`ml-auto ${editingId === s.id ? 'text-orange-400' : 'text-gray-400'} hover:text-orange-300`}
                onClick={() => (editingId === s.id ? closeEditor() : setEditingId(s.id))}
              >
                <IconPencil size={18} />
              </button>
              <button
                type="button"
                aria-label={`Copy ${s.name}`}
                className="text-gray-400 hover:text-orange-300"
                onClick={() => {
                  const copy = store.copySetup(s.id);
                  if (copy) setEditingId(copy.id);
                }}
              >
                <IconCopy size={18} />
              </button>
              <button
                type="button"
                aria-label={`Remove ${s.name}`}
                className="text-gray-400 hover:text-red-300"
                onClick={() => store.removeSetup(s.id)}
              >
                <IconTrash size={18} />
              </button>
            </li>
            {editingId === s.id && (
            <li className="border-b border-body-200 dark:border-dark-400">
              <SetupEditor setupId={s.id} />
            </li>
            )}
          </React.Fragment>
        ))}
      </ul>
    </Panel>
  );
});

export default SetupList;
