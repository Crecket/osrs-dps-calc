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
 * A pool of workers that computes every payload of the current run, one payload per message. It never debounces or
 * drops payloads; starting a new run cancels the previous one.
 */
export class TaskPool<P, R> {
  private size: number;

  private progressInterval: number;

  private createWorker: () => WorkerLike;

  private terminateOnCancel: boolean;

  private workers: PoolWorker[] = [];

  private current: Run<P, R> | null = null;

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
   */
  run(payloads: P[], onProgress: (p: TaskProgress<R>) => void, count: (p: P) => number = () => 1): Promise<R[]> {
    this.cancel();

    if (payloads.length === 0) return Promise.resolve([]);

    this.nextRunId += 1;
    const runId = this.nextRunId;
    const queue = payloads.map((payload, chunkId) => ({ runId, chunkId, payload }));
    const total = payloads.reduce((n, p) => n + count(p), 0);

    return new Promise<R[]>((resolve, reject) => {
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
      if (this.terminateOnCancel) {
        // a busy worker would finish its stale chunk before taking new work; ensureWorkers spawns replacements on the next run
        this.workers.filter((w) => w.runId !== null).forEach((w) => w.worker.terminate());
        this.workers = this.workers.filter((w) => w.runId === null);
      }
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
    const res = JSON.parse(data, WORKER_JSON_REVIVER) as TaskResult<R>;
    const run = this.current;

    if (run && res.runId === run.runId) {
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
