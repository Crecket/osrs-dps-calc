import { toJS } from 'mobx';
import { toast } from 'react-toastify';
import { BulkStore } from '@/bulk/state/BulkStore';
import { notifyPresetsChanged } from '@/bulk/state/presetChannel';
import { newId } from '@/bulk/lib/presetIO';
import { BulkSetup } from '@/bulk/types';

/**
 * Saves results as setups in the bulk tool's active preset, read fresh from storage so the bulk page's own state isn't
 * needed here.
 */
const addToBulkPreset = async (setups: BulkSetup[]) => {
  const bulk = new BulkStore();
  // load always leaves an active preset
  await bulk.load();
  const preset = bulk.active;
  const one = setups.length === 1;
  if (!bulk.persists() || !preset) {
    toast.error(`The bulk tool's presets could not be read, so ${one ? 'the setup was' : 'the setups were'} not added`);
    return;
  }
  const result = bulk.addSetups(setups.map((setup) => ({ id: newId(), name: setup.name, player: toJS(setup.player) })));
  if (result.added === 0) {
    toast.info(`${one ? 'That setup is' : 'Those setups are'} already in ${preset.name}`);
    return;
  }
  if (!await bulk.whenSaved()) {
    toast.error('Could not save the bulk tool\'s presets');
    return;
  }
  notifyPresetsChanged();
  toast.success(one ? `Added to ${preset.name}` : `Added ${result.added} setup${result.added === 1 ? '' : 's'} to ${preset.name}`);
};

export default addToBulkPreset;
