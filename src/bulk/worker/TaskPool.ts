import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';

export interface WorkerLike {
  postMessage(m: string): void;
  onmessage: ((e: { data: string }) => void) | null;
  onerror?: ((e: { message?: string }) => void) | null;
  terminate(): void;
}

/** What the pool sends a worker: one payload, tagged so that a late answer from a cancelled run can be told apart. */
export interface TaskChunk<P> {
  runId: number;
  chunkId: number;
  payload: P;
}

/** What a worker answers for one chunk. */
export interface TaskResult<R> {
  runId: number;
  chunkId: number;
  results: R[];
}

export interface TaskProgress<R> {
  results: R[];
  done: number;
  total: number;
}

interface PoolWorker {
  worker: WorkerLike;
  // the run whose chunk this worker is computing, or null when idle
  runId: number | null;
}

interface Run<P, R> {
  runId: number;
  queue: TaskChunk<P>[];
  outstanding: number;
  // results by chunk id, so that results stay in payload order however the chunks finish
  chunks: R[][];
  done: number;
  total: number;
  lastProgress: number;
  onProgress: (p: TaskProgress<R>) => void;
  resolve: (results: R[]) => void;
  reject: (e: Error) => void;
}

export const defaultPoolSize = () => Math.max(1, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2) - 1);

/**
 * A pool of workers that computes every payload of its runs, one payload per message. It never debounces or drops
 * payloads. Starting a run cancels the earlier ones, unless it is `concurrent`: concurrent runs share the workers, the
 * oldest run's payloads first, so a worker one run leaves idle picks up another's.
 */
export class TaskPool<P, R> {
  private size: number;

  private progressInterval: number;

  private createWorker: () => WorkerLike;

  private terminateOnCancel: boolean;

  private workers: PoolWorker[] = [];

  // in start order: dispatch serves the oldest run first
  private runs = new Map<number, Run<P, R>>();

  private nextRunId = 0;

  /**
   * @param opts.progressInterval minimum ms between progress reports (the finished run is always reported)
   * @param opts.terminateOnCancel terminate workers busy with a cancelled run's chunk instead of letting them finish it;
   * worth it for long chunks, while short ones finish sooner than a new worker starts
   */
  constructor(opts: { createWorker: () => WorkerLike; size?: number; progressInterval?: number; terminateOnCancel?: boolean }) {
    this.createWorker = opts.createWorker;
    this.terminateOnCancel = opts.terminateOnCancel ?? false;
    this.size = opts.size ?? defaultPoolSize();
    this.progressInterval = opts.progressInterval ?? 100;
  }

  /**
   * Computes every payload; resolves with their results in payload order.
   * @param count the number of results a payload yields, for the progress total
   * @param opts.concurrent keep earlier runs going and share the workers with them
   */
  run(
    payloads: P[],
    onProgress: (p: TaskProgress<R>) => void,
    count: (p: P) => number = () => 1,
    opts: { concurrent?: boolean } = {},
  ): Promise<R[]> {
    if (!opts.concurrent) this.cancel();

    if (payloads.length === 0) return Promise.resolve([]);

    this.nextRunId += 1;
    const runId = this.nextRunId;
    const queue = payloads.map((payload, chunkId) => ({ runId, chunkId, payload }));
    const total = payloads.reduce((n, p) => n + count(p), 0);

    return new Promise<R[]>((resolve, reject) => {
      this.runs.set(runId, {
        runId, queue, outstanding: 0, chunks: [], done: 0, total, lastProgress: Date.now(), onProgress, resolve, reject,
      });
      this.ensureWorkers(this.pending());
      this.dispatch();
    });
  }

  /** Cancels every run */
  cancel() {
    if (this.runs.size === 0) return;
    const cancelled = [...this.runs.values()];
    this.runs.clear();
    if (this.terminateOnCancel) {
      // a busy worker would finish its stale chunk before taking new work; ensureWorkers spawns replacements on the next run
      this.workers.filter((w) => w.runId !== null).forEach((w) => w.worker.terminate());
      this.workers = this.workers.filter((w) => w.runId === null);
    }
    cancelled.forEach((run) => run.reject(new Error('cancelled')));
  }

  // payloads waiting or being computed, which is how many workers could be busy
  private pending() {
    let n = 0;
    this.runs.forEach((run) => { n += run.queue.length + run.outstanding; });
    return n;
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
    for (const pw of this.workers) {
      if (pw.runId !== null) continue;
      // the oldest run with payloads left
      const run = [...this.runs.values()].find((r) => r.queue.length > 0);
      if (!run) return;
      const chunk = run.queue.shift()!;
      pw.runId = run.runId;
      run.outstanding += 1;
      pw.worker.postMessage(JSON.stringify(chunk, WORKER_JSON_REPLACER));
    }
  }

  private onResponse(pw: PoolWorker, data: string) {
    pw.runId = null;
    const res = JSON.parse(data, WORKER_JSON_REVIVER) as TaskResult<R>;
    const run = this.runs.get(res.runId);

    if (run) {
      run.outstanding -= 1;
      run.chunks[res.chunkId] = res.results;
      run.done += res.results.length;
      const finished = run.queue.length === 0 && run.outstanding === 0;

      const now = Date.now();
      if (finished || now - run.lastProgress >= this.progressInterval) {
        run.lastProgress = now;
        run.onProgress({ results: run.chunks.flat(), done: run.done, total: run.total });
      }

      if (finished) {
        this.runs.delete(run.runId);
        run.resolve(run.chunks.flat());
      }
    }

    this.dispatch();
  }

  private onWorkerError(pw: PoolWorker, message?: string) {
    // a crashed worker can't be trusted to respond; drop it, and fail the run only if the crash was on one of its chunks
    pw.worker.terminate();
    this.workers = this.workers.filter((w) => w !== pw);
    const run = pw.runId === null ? undefined : this.runs.get(pw.runId);
    if (run) {
      this.runs.delete(run.runId);
      run.reject(new Error(message || 'A calculation worker crashed'));
    }

    this.ensureWorkers(this.pending());
    this.dispatch();
  }
}
