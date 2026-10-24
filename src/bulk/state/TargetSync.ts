import {
  IReactionDisposer, reaction, runInAction, toJS,
} from 'mobx';
import isEqual from 'lodash.isequal';
import { GlobalState } from '@/state';
import { Monster } from '@/types/Monster';
import { newId } from '@/bulk/lib/presetIO';
import { BulkMonster } from '@/bulk/types';

/** What TargetSync needs from a store that owns a target monster. */
export interface TargetHolder {
  /** Changes when a different preset or page is active, so the target is reloaded */
  readonly targetScope: unknown;
  readonly target: BulkMonster | null;
  setTarget(m: BulkMonster): void;
  /** False while there is nowhere to put a target */
  readonly canSave: boolean;
}

/**
 * Keeps the holder's target monster and a private calculator store in step, so that upstream's own monster panel
 * (search, raid scaling, phases, defence reductions, custom monsters...) can edit the target. The calculator's real
 * store and its saved session are never touched.
 */
class TargetSync {
  private disposers: IReactionDisposer[] = [];

  /**
   * @param delay ms to batch panel edits (typing in a number input) into one change of target
   */
  constructor(private holder: TargetHolder, private calc: GlobalState, private delay = 300) {}

  start() {
    this.disposers.push(
      reaction(
        () => [this.holder.targetScope, toJS(this.holder.target?.monster)] as const,
        () => this.load(),
        { fireImmediately: true, equals: (a, b) => isEqual(a, b) },
      ),
      reaction(
        () => toJS(this.calc.monster),
        () => this.save(),
        { delay: this.delay || undefined, equals: (a, b) => isEqual(a, b) },
      ),
    );
  }

  dispose() {
    this.disposers.forEach((d) => d());
    this.disposers = [];
  }

  private load() {
    const target = this.holder.target;
    if (!target) {
      // a preset without a target takes whatever the panel shows, so there is always something to compare against
      this.save();
      return;
    }
    if (isEqual(toJS(target.monster), toJS(this.calc.monster))) return;
    runInAction(() => {
      this.calc.monster = toJS(target.monster);
    });
  }

  private save() {
    if (!this.holder.canSave) return;
    const monster: Monster = toJS(this.calc.monster);
    const current = this.holder.target;
    if (current && isEqual(toJS(current.monster), monster)) return;
    // keep the entry's id while it's the same monster, so only a different monster counts as a new target
    const same = current && current.monster.id === monster.id && current.monster.name === monster.name;
    this.holder.setTarget({ id: same ? current.id : newId(), monster });
  }
}

export default TargetSync;
