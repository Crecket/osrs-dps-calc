import {
  afterEach, describe, expect, test,
} from '@jest/globals';
import {
  defaultPoolSize, TaskChunk, TaskPool, TaskResult, WorkerLike, WorkerLimit,
} from '@/bulk/worker/TaskPool';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';

// counts the workers alive at once, and the most there ever were
class Live {
  now = 0;

  peak = 0;

  worker(delay = 1, crashes = false): WorkerLike {
    this.now += 1;
    this.peak = Math.max(this.peak, this.now);
    let terminated = false;
    const w: WorkerLike = {
      onmessage: null,
      onerror: null,
      postMessage: (m) => {
        const req = JSON.parse(m, WORKER_JSON_REVIVER) as TaskChunk<number>;
        setTimeout(() => {
          if (terminated) return;
          if (crashes) {
            w.onerror?.({ message: 'boom' });
            return;
          }
          const res: TaskResult<number> = { runId: req.runId, chunkId: req.chunkId, results: [req.payload] };
          w.onmessage?.({ data: JSON.stringify(res, WORKER_JSON_REPLACER) });
        }, delay);
      },
      terminate: () => {
        if (!terminated) this.now -= 1;
        terminated = true;
      },
    };
    return w;
  }
}

const payloads = (n: number) => Array.from({ length: n }, (_, i) => i);
const noProgress = () => {};

describe('WorkerLimit', () => {
  test('two pools working at once stay within the limit and both finish', async () => {
    const live = new Live();
    const limit = new WorkerLimit(3);
    const a = new TaskPool<number, number>({ size: 3, limit, createWorker: () => live.worker() });
    const b = new TaskPool<number, number>({ size: 3, limit, createWorker: () => live.worker() });

    const [ra, rb] = await Promise.all([a.run(payloads(9), noProgress), b.run(payloads(9), noProgress)]);

    expect(ra).toEqual(payloads(9));
    expect(rb).toEqual(payloads(9));
    expect(live.peak).toBe(3);
  });

  test('a pool takes over the idle workers of a pool that finished', async () => {
    const live = new Live();
    const limit = new WorkerLimit(2);
    const a = new TaskPool<number, number>({ size: 2, limit, createWorker: () => live.worker() });
    let spawnedByB = 0;
    const b = new TaskPool<number, number>({
      size: 2,
      limit,
      createWorker: () => {
        spawnedByB += 1;
        return live.worker();
      },
    });

    await a.run(payloads(4), noProgress);
    expect(live.now).toBe(2);
    await b.run(payloads(4), noProgress);

    expect(spawnedByB).toBe(2);
    expect(live.now).toBe(2);
    expect(live.peak).toBe(2);
  });

  test('a cancelled pool gives its workers back to a pool waiting for them', async () => {
    const live = new Live();
    const limit = new WorkerLimit(2);
    const a = new TaskPool<number, number>({
      size: 2, limit, terminateOnCancel: true, createWorker: () => live.worker(10000),
    });
    const b = new TaskPool<number, number>({ size: 2, limit, createWorker: () => live.worker() });

    const cancelled = a.run(payloads(2), noProgress).catch((e: Error) => e.message);
    const waiting = b.run(payloads(4), noProgress);
    a.cancel();

    expect(await cancelled).toBe('cancelled');
    expect(await waiting).toEqual(payloads(4));
    expect(live.peak).toBe(2);
  });

  test('a crashed worker gives its place back', async () => {
    const live = new Live();
    const limit = new WorkerLimit(1);
    const a = new TaskPool<number, number>({ size: 1, limit, createWorker: () => live.worker(1, true) });
    const b = new TaskPool<number, number>({ size: 1, limit, createWorker: () => live.worker() });

    await expect(a.run(payloads(1), noProgress)).rejects.toThrow('boom');

    expect(await b.run(payloads(2), noProgress)).toEqual(payloads(2));
    expect(live.peak).toBe(1);
  });

  test('shutdown gives every place back', async () => {
    const live = new Live();
    const limit = new WorkerLimit(2);
    const a = new TaskPool<number, number>({ size: 2, limit, createWorker: () => live.worker() });

    await a.run(payloads(2), noProgress);
    a.shutdown();
    expect(live.now).toBe(0);

    expect(await a.run(payloads(2), noProgress)).toEqual(payloads(2));
    expect(live.peak).toBe(2);
  });
});

describe('defaultPoolSize', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'hardwareConcurrency');
  const threads = (n: number) => Object.defineProperty(navigator, 'hardwareConcurrency', { value: n, configurable: true });

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'hardwareConcurrency', original);
    else delete (navigator as unknown as Record<string, unknown>).hardwareConcurrency;
  });

  test('leaves one thread free on a small machine', () => {
    threads(8);
    expect(defaultPoolSize()).toBe(7);
  });

  test('never goes above 24 workers, however many threads there are', () => {
    threads(32);
    expect(defaultPoolSize()).toBe(24);
  });
});
