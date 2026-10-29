import { BulkPayload } from '@/bulk/worker/protocol';
import { TaskPool, WorkerLike } from '@/bulk/worker/TaskPool';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';

export type { WorkerLike } from '@/bulk/worker/TaskPool';
export { defaultPoolSize } from '@/bulk/worker/TaskPool';

export interface BulkProgress {
  rows: BulkRow[];
  done: number;
  total: number;
}

// only send the setups and monsters that the chunk's jobs use, re-indexed
const buildPayload = (jobs: [number, number][], setups: BulkSetup[], monsters: BulkMonster[]): BulkPayload => {
  const sIx = [...new Set(jobs.map(([s]) => s))];
  const mIx = [...new Set(jobs.map(([, m]) => m))];
  return {
    setups: sIx.map((i) => setups[i]),
    monsters: mIx.map((i) => monsters[i]),
    jobs: jobs.map(([s, m]) => [sIx.indexOf(s), mIx.indexOf(m)]),
  };
};

/**
 * A pool of bulk calc workers: every setup × monster of a run is computed, in chunks of `chunkSize` jobs.
 * Starting a new run cancels the previous one, unless it is concurrent.
 */
export class BulkPool {
  private chunkSize: number;

  private pool: TaskPool<BulkPayload, BulkRow>;

  /**
   * @param opts.progressInterval minimum ms between progress reports (the finished run is always reported)
   */
  constructor(opts: { createWorker: () => WorkerLike; size?: number; chunkSize?: number; progressInterval?: number }) {
    this.chunkSize = opts.chunkSize ?? 25;
    this.pool = new TaskPool(opts);
  }

  /** @param opts.concurrent keep earlier runs going and share the workers with them */
  run(setups: BulkSetup[], monsters: BulkMonster[], onProgress: (p: BulkProgress) => void, opts: { concurrent?: boolean } = {}): Promise<BulkRow[]> {
    const jobs: [number, number][] = [];
    setups.forEach((_, s) => monsters.forEach((__, m) => jobs.push([s, m])));

    const payloads: BulkPayload[] = [];
    for (let i = 0; i < jobs.length; i += this.chunkSize) {
      payloads.push(buildPayload(jobs.slice(i, i + this.chunkSize), setups, monsters));
    }

    return this.pool.run(payloads, ({ results, done, total }) => onProgress({ rows: results, done, total }), (p) => p.jobs.length, opts);
  }

  cancel() {
    this.pool.cancel();
  }

  shutdown() {
    this.pool.shutdown();
  }
}
