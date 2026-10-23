import React from 'react';
import { StoreProvider } from '@/state';
import PlayerInnerContainer from '@/app/components/player/PlayerInnerContainer';
import useSetupStore from '@/bulk/components/useSetupStore';

/**
 * Upstream's whole loadout panel (equipment, combat style and spells, skills and potions, prayers, extra options),
 * editing one setup.
 */
const SetupEditor: React.FC<{ setupId: string }> = ({ setupId }) => {
  const calc = useSetupStore(setupId);
  return (
    <div className="mx-auto max-w-[480px] my-2 rounded-lg overflow-hidden bg-tile dark:bg-dark-300 text-black dark:text-white shadow-lg">
      <StoreProvider store={calc}>
        <PlayerInnerContainer />
      </StoreProvider>
    </div>
  );
};

export default SetupEditor;
