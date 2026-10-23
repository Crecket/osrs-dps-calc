import { BulkChunkRequest, BulkChunkResponse } from '@/bulk/worker/protocol';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';

export interface WorkerLike {
  postMessage(m: string): void;
  onmessage: ((e: { data: string }) => void) | null;
  onerror?: ((e: { message?: string }) => void) | null;
  terminate(): void;
}

export interface BulkProgress {
  rows: BulkRow[];
  done: number;
  total: number;
}

interface PoolWorker {
  worker: WorkerLike;
  // the run whose chunk this worker is computing, or null when idle
  runId: number | null;
}

interface Run {
  runId: number;
  queue: BulkChunkRequest[];
  outstanding: number;
  // results by chunk id, so that rows stay in setup × monster order however the chunks finish
  chunks: BulkRow[][];
  done: number;
  total: number;
  lastProgress: number;
  onProgress: (p: BulkProgress) => void;
  resolve: (rows: BulkRow[]) => void;
  reject: (e: Error) => void;
}

export const defaultPoolSize = () => Math.max(1, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1);

// only send the setups and monsters that the chunk's jobs use, re-indexed
const buildChunk = (
  runId: number,
  chunkId: number,
  jobs: [number, number][],
  setups: BulkSetup[],
  monsters: BulkMonster[],
): BulkChunkRequest => {
  const sIx = [...new Set(jobs.map(([s]) => s))];
  const mIx = [...new Set(jobs.map(([, m]) => m))];
  return {
    runId,
    chunkId,
    setups: sIx.map((i) => setups[i]),
    monsters: mIx.map((i) => monsters[i]),
    jobs: jobs.map(([s, m]) => [sIx.indexOf(s), mIx.indexOf(m)]),
  };
};

/**
 * A pool of bulk calc workers. Unlike the calculator's CalcWorker, it never debounces or drops requests: every job of
 * the current run is computed. Starting a new run cancels the previous one.
 */
export class BulkPool {
  private size: number;

  private chunkSize: number;

  private progressInterval: number;

  private createWorker: () => WorkerLike;

  private workers: PoolWorker[] = [];

  private current: Run | null = null;

  private nextRunId = 0;

  /**
   * @param opts.progressInterval minimum ms between progress reports (the finished run is always reported)
   */
  constructor(opts: { createWorker: () => WorkerLike; size?: number; chunkSize?: number; progressInterval?: number }) {
    this.createWorker = opts.createWorker;
    this.size = opts.size ?? defaultPoolSize();
    this.chunkSize = opts.chunkSize ?? 25;
    this.progressInterval = opts.progressInterval ?? 100;
  }

  run(setups: BulkSetup[], monsters: BulkMonster[], onProgress: (p: BulkProgress) => void): Promise<BulkRow[]> {
    this.cancel();

    const total = setups.length * monsters.length;
    if (total === 0) return Promise.resolve([]);

    this.nextRunId += 1;
    const runId = this.nextRunId;
    const jobs: [number, number][] = [];
    setups.forEach((_, s) => monsters.forEach((__, m) => jobs.push([s, m])));

    const queue: BulkChunkRequest[] = [];
    for (let i = 0; i < jobs.length; i += this.chunkSize) {
      queue.push(buildChunk(runId, queue.length, jobs.slice(i, i + this.chunkSize), setups, monsters));
    }

    return new Promise<BulkRow[]>((resolve, reject) => {
      this.current = {
        runId, queue, outstanding: 0, chunks: [], done: 0, total, lastProgress: Date.now(), onProgress, resolve, reject,
      };
      this.ensureWorkers(queue.length);
      this.dispatch();
    });
  }

  cancel() {
    if (this.current) {
      const { reject } = this.current;
      this.current = null;
      reject(new Error('cancelled'));
    }
  }

  shutdown() {
    this.cancel();
    for (const w of this.workers) w.worker.terminate();
    this.workers = [];
  }

  private ensureWorkers(chunks: number) {
    while (this.workers.length < Math.min(this.size, chunks)) {
      const pw: PoolWorker = { worker: this.createWorker(), runId: null };
      pw.worker.onmessage = (e) => this.onResponse(pw, e.data);
      pw.worker.onerror = (e) => this.onWorkerError(pw, e?.message);
      this.workers.push(pw);
    }
  }

  private dispatch() {
    const run = this.current;
    if (!run) return;
    for (const pw of this.workers) {
      if (pw.runId === null && run.queue.length > 0) {
        const chunk = run.queue.shift()!;
        pw.runId = run.runId;
        run.outstanding += 1;
        pw.worker.postMessage(JSON.stringify(chunk, WORKER_JSON_REPLACER));
      }
    }
  }

  private onResponse(pw: PoolWorker, data: string) {
    pw.runId = null;
    const res = JSON.parse(data, WORKER_JSON_REVIVER) as BulkChunkResponse;
    const run = this.current;

    if (run && res.runId === run.runId) {
      run.outstanding -= 1;
      run.chunks[res.chunkId] = res.rows;
      run.done += res.rows.length;
      const finished = run.queue.length === 0 && run.outstanding === 0;

      const now = Date.now();
      if (finished || now - run.lastProgress >= this.progressInterval) {
        run.lastProgress = now;
        run.onProgress({ rows: run.chunks.flat(), done: run.done, total: run.total });
      }

      if (finished) {
        this.current = null;
        run.resolve(run.chunks.flat());
        return;
      }
    }

    this.dispatch();
  }

  private onWorkerError(pw: PoolWorker, message?: string) {
    // a crashed worker can't be trusted to respond; drop it, and fail the run only if the crash was on one of its chunks
    pw.worker.terminate();
    this.workers = this.workers.filter((w) => w !== pw);
    const run = this.current;
    if (!run) return;

    if (pw.runId === run.runId) {
      this.current = null;
      run.reject(new Error(message || 'A calculation worker crashed'));
      return;
    }

    this.ensureWorkers(run.queue.length);
    this.dispatch();
  }
}
