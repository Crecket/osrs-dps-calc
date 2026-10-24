import { describe, expect, test } from '@jest/globals';
import {
  TaskChunk, TaskPool, TaskResult, WorkerLike,
} from '@/bulk/worker/TaskPool';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';

// a payload is a list of numbers; the worker squares each
class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: string }) => void) | null = null;

  onerror: ((e: { message?: string }) => void) | null = null;

  terminated = false;

  constructor(private opts: { delay?: (chunkId: number) => number; crashOnRun?: number } = {}) {}

  postMessage(m: string) {
    const req = JSON.parse(m, WORKER_JSON_REVIVER) as TaskChunk<number[]>;
    setTimeout(() => {
      if (this.terminated) return;
      if (req.runId === this.opts.crashOnRun) {
        this.onerror?.({ message: 'boom' });
        return;
      }
      const res: TaskResult<number> = { runId: req.runId, chunkId: req.chunkId, results: req.payload.map((n) => n * n) };
      this.onmessage?.({ data: JSON.stringify(res, WORKER_JSON_REPLACER) });
    }, this.opts.delay?.(req.chunkId) ?? 0);
  }

  terminate() {
    this.terminated = true;
  }
}

describe('TaskPool', () => {
  test('results come back in payload order even when workers finish out of order', async () => {
    const pool = new TaskPool<number[], number>({
      size: 3,
      // later chunks finish first
      createWorker: () => new FakeWorker({ delay: (chunkId) => (10 - chunkId) * 3 }),
    });

    const results = await pool.run([[1, 2], [3], [4, 5]], () => {}, (p) => p.length);

    expect(results).toEqual([1, 4, 9, 16, 25]);
  });

  test('progress done counts results against the counted total', async () => {
    const pool = new TaskPool<number[], number>({ size: 2, progressInterval: 0, createWorker: () => new FakeWorker() });
    const progress: { done: number; total: number }[] = [];

    await pool.run([[1, 2], [3], [4, 5, 6]], (p) => progress.push({ done: p.done, total: p.total }), (p) => p.length);

    expect(progress.map((p) => p.total)).toEqual(progress.map(() => 6));
    expect(progress[progress.length - 1]).toEqual({ done: 6, total: 6 });
    expect(progress.map((p) => p.done).every((d) => [1, 2, 3, 4, 5, 6].includes(d))).toBe(true);
  });

  test('count defaults to one result per payload', async () => {
    const pool = new TaskPool<number[], number>({ size: 1, createWorker: () => new FakeWorker() });
    const totals: number[] = [];

    await pool.run([[1], [2], [3]], (p) => totals.push(p.total));

    expect(totals[totals.length - 1]).toBe(3);
  });

  test('cancel() rejects the run and ignores late responses', async () => {
    const pool = new TaskPool<number[], number>({ size: 1, createWorker: () => new FakeWorker({ delay: () => 5 }) });
    let reported = 0;

    const run = pool.run([[1], [2]], () => { reported += 1; });
    pool.cancel();

    await expect(run).rejects.toThrow('cancelled');
    await new Promise((r) => { setTimeout(r, 30); });
    expect(reported).toBe(0);
  });

  test('cancel() terminates busy workers, and the next run spawns new ones', async () => {
    const workers: FakeWorker[] = [];
    const pool = new TaskPool<number[], number>({
      size: 2,
      createWorker: () => {
        const w = new FakeWorker({ delay: () => 5 });
        workers.push(w);
        return w;
      },
    });

    // one chunk: one worker busy, one idle
    const first = pool.run([[1]], () => {});
    const second = pool.run([[2], [3]], () => {});
    await expect(first).rejects.toThrow('cancelled');
    // the run that cancelled the first one replaced its busy worker
    expect(workers[0].terminated).toBe(true);
    await expect(second).resolves.toEqual([4, 9]);
    expect(workers.filter((w) => !w.terminated).length).toBe(2);

    const third = pool.run([[4]], () => {});
    const busy = workers.filter((w) => !w.terminated);
    pool.cancel();
    await expect(third).rejects.toThrow('cancelled');
    // only the worker computing a chunk is terminated
    expect(busy.filter((w) => w.terminated).length).toBe(1);
  });

  test('a worker crash during a run rejects it', async () => {
    const pool = new TaskPool<number[], number>({ size: 1, createWorker: () => new FakeWorker({ crashOnRun: 1 }) });

    await expect(pool.run([[1]], () => {})).rejects.toThrow('boom');
  });

  test('no payloads resolves immediately with [] and spawns no workers', async () => {
    let spawned = 0;
    const pool = new TaskPool<number[], number>({
      size: 2,
      createWorker: () => {
        spawned += 1;
        return new FakeWorker();
      },
    });

    await expect(pool.run([], () => {})).resolves.toEqual([]);
    expect(spawned).toBe(0);
  });
});
