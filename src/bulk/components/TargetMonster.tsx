import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { toast } from 'react-toastify';
import { GlobalState, StoreProvider } from '@/state';
import MonsterContainer from '@/app/components/monster/MonsterContainer';
import { useBulkStore } from '@/bulk/state/BulkStore';
import TargetSync, { TargetHolder } from '@/bulk/state/TargetSync';
import { fromCalculatorState, readCalculatorState } from '@/bulk/lib/presetIO';
import { buttonClass } from '@/bulk/components/Panel';

/**
 * The target monster, edited with upstream's own monster panel (bound to a private calculator store), so every option
 * the calculator has for a monster is available here too.
 */
const TargetMonster: React.FC<{ holder?: TargetHolder }> = observer(({ holder: given }) => {
  const bulk = useBulkStore();
  const holder = given ?? bulk;
  const [calc] = useState(() => new GlobalState());

  useEffect(() => {
    const sync = new TargetSync(holder, calc);
    sync.start();
    return () => sync.dispose();
  }, [holder, calc]);

  const importCalculatorMonster = async () => {
    const state = await readCalculatorState();
    if (!state?.monster) {
      toast.error('Open the calculator first so there is something to import');
      return;
    }
    try {
      holder.setTarget(fromCalculatorState({ ...state, loadouts: [] }, 'all').monster);
    } catch (e) {
      toast.error(`Could not import from the calculator: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="grow basis-[360px] flex flex-col">
      <div className="flex justify-end">
        <button type="button" className={buttonClass} onClick={importCalculatorMonster}>Use calculator&apos;s monster</button>
      </div>
      <StoreProvider store={calc}>
        <MonsterContainer />
      </StoreProvider>
    </div>
  );
});

export default TargetMonster;
