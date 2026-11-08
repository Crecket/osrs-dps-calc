import { RowPart } from '@/bulk/lib/compute';
import { slimSetup } from '@/bulk/lib/slimSetup';
import { BulkPayload } from '@/bulk/worker/protocol';
import { TaskPool, WorkerLike, WorkerLimit } from '@/bulk/worker/TaskPool';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';

export type { WorkerLike } from '@/bulk/worker/TaskPool';
export { defaultPoolSize } from '@/bulk/worker/TaskPool';

export interface BulkProgress {
  rows: BulkRow[];
  done: number;
  total: number;
}

// a chunk of partial rows is this many times as large: without kill times 25 jobs are about a millisecond of work, less
// than sending them costs
const PARTIAL_CHUNK_FACTOR = 4;

// only send the setups and monsters that the chunk's jobs use, re-indexed
const buildPayload = (jobs: [number, number][], setups: BulkSetup[], monsters: BulkMonster[], only?: RowPart): BulkPayload => {
  const sIx = [...new Set(jobs.map(([s]) => s))];
  const mIx = [...new Set(jobs.map(([, m]) => m))];
  return {
    setups: sIx.map((i) => (only ? slimSetup(setups[i]) : setups[i])),
    monsters: mIx.map((i) => monsters[i]),
    jobs: jobs.map(([s, m]) => [sIx.indexOf(s), mIx.indexOf(m)]),
    ...(only ? { only } : {}),
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
   * @param opts.limit shared with the other pools of a page, so that together they stay within it
   */
  constructor(opts: { createWorker: () => WorkerLike; size?: number; chunkSize?: number; progressInterval?: number; limit?: WorkerLimit }) {
    this.chunkSize = opts.chunkSize ?? 25;
    this.pool = new TaskPool(opts);
  }

  /**
   * @param opts.concurrent keep earlier runs going and share the workers with them
   * @param opts.only compute only this part of each row
   */
  run(setups: BulkSetup[], monsters: BulkMonster[], onProgress: (p: BulkProgress) => void, opts: { concurrent?: boolean; only?: RowPart } = {}): Promise<BulkRow[]> {
    const jobs: [number, number][] = [];
    setups.forEach((_, s) => monsters.forEach((__, m) => jobs.push([s, m])));

    const payloads: BulkPayload[] = [];
    const chunkSize = opts.only ? this.chunkSize * PARTIAL_CHUNK_FACTOR : this.chunkSize;
    for (let i = 0; i < jobs.length; i += chunkSize) {
      payloads.push(buildPayload(jobs.slice(i, i + chunkSize), setups, monsters, opts.only));
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
