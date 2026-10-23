import {
  IReactionDisposer, reaction, runInAction, toJS,
} from 'mobx';
import isEqual from 'lodash.isequal';
import { GlobalState } from '@/state';
import { BulkStore } from '@/bulk/state/BulkStore';

/**
 * Keeps one setup and a private calculator store in step, so that upstream's own prayer, potion and level controls can
 * edit the setup (including their rules, like conflicting prayers, and the boosts potions give).
 */
class SetupSync {
  private disposers: IReactionDisposer[] = [];

  constructor(private bulk: BulkStore, private calc: GlobalState, private setupId: string, private delay = 300) {}

  private get setup() {
    return this.bulk.active?.setups.find((s) => s.id === this.setupId) || null;
  }

  start() {
    this.disposers.push(
      reaction(() => toJS(this.setup?.player), () => this.load(), { fireImmediately: true, equals: (a, b) => isEqual(a, b) }),
      reaction(() => toJS(this.calc.player), () => this.save(), { delay: this.delay || undefined, equals: (a, b) => isEqual(a, b) }),
    );
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }

  private load() {
    const player = this.setup?.player;
    if (!player || isEqual(toJS(player), toJS(this.calc.player))) return;
    runInAction(() => {
      this.calc.loadouts = [toJS(player)];
      this.calc.selectedLoadout = 0;
    });
  }

  private save() {
    const setup = this.setup;
    if (!setup) return;
    const player = toJS(this.calc.player);
    if (isEqual(toJS(setup.player), player)) return;
    this.bulk.updateSetupPlayer(this.setupId, player);
  }
}

export default SetupSync;
