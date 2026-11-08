// how long after a change it waits for more changes, and at most: typing all the time must still get saved
const SAVE_DELAY = 300;
const MAX_SAVE_DELAY = 3000;

/**
 * Runs `write` once changes settle, so a burst of them writes the state once. `write` reads the state when it runs, so
 * the latest state always gets written. Whoever owns it must flush when the page goes away.
 */
export default class DebouncedWrite {
  private timer: ReturnType<typeof setTimeout> | null = null;

  // when the oldest unwritten change was made; null when all are written
  private dirtySince: number | null = null;

  constructor(private write: () => void) {}

  schedule() {
    if (this.timer) clearTimeout(this.timer);
    const now = Date.now();
    this.dirtySince ??= now;
    this.timer = setTimeout(() => this.flush(), Math.min(SAVE_DELAY, Math.max(0, this.dirtySince + MAX_SAVE_DELAY - now)));
  }

  /** Writes any unwritten changes now */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.dirtySince === null) return;
    this.dirtySince = null;
    this.write();
  }
}
