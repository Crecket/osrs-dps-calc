import { IReactionDisposer, reaction, toJS } from 'mobx';
import isEqual from 'lodash.isequal';
import RootStore from '@/state/RootStore';
import { BulkStore } from '@/bulk/state/BulkStore';
import { Player } from '@/types/Player';

/**
 * Keeps one setup and a private calculator store in step, so that upstream's own prayer, potion and level controls can
 * edit the setup (including their rules, like conflicting prayers, and the boosts potions give).
 */
class SetupSync {
  private disposers: IReactionDisposer[] = [];

  // the panel's player at the last load or save. The panel derives its stats from the gear, so after a load it can differ
  // from the setup without anything having been edited
  private synced: Player | null = null;

  constructor(private bulk: BulkStore, private calc: RootStore, private setupId: string, private delay = 300) {}

  private get setup() {
    return this.bulk.active?.setups.find((s) => s.id === this.setupId) || null;
  }

  private get panel(): Player {
    return this.calc.loadouts.currentLoadout.snapshot;
  }

  start() {
    this.disposers.push(
      reaction(() => toJS(this.setup?.player), () => this.load(), { fireImmediately: true, equals: (a, b) => isEqual(a, b) }),
      reaction(() => this.panel, () => this.save(), { delay: this.delay || undefined, equals: (a, b) => isEqual(a, b) }),
    );
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }

  private load() {
    const player = toJS(this.setup?.player);
    if (!player || isEqual(player, this.synced)) return;
    this.calc.loadouts.replaceAll([player]);
    this.synced = this.panel;
  }

  private save() {
    const { panel } = this;
    if (!this.setup || isEqual(panel, this.synced)) return;
    this.synced = panel;
    this.bulk.updateSetupPlayer(this.setupId, panel);
  }
}

export default SetupSync;
