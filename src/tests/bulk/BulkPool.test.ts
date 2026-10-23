import { describe, expect, test } from '@jest/globals';
import { BulkPool, WorkerLike } from '@/bulk/worker/BulkPool';
import { handleChunk } from '@/bulk/worker/protocol';
import { monsterFromSearch } from '@/bulk/lib/presetIO';
import { BulkSetup } from '@/bulk/types';
import { getMonsters } from '@/lib/Monsters';
import { generateEmptyPlayer } from '@/state';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';

class FakeWorker implements WorkerLike {
  onmessage: ((e: { data: string }) => void) | null = null;

  onerror: ((e: { message?: string }) => void) | null = null;

  received = 0;

  terminated = false;

  constructor(private opts: { delay?: (chunkId: number) => number; crashOnRun?: number } = {}) {}

  postMessage(m: string) {
    this.received += 1;
    const req = JSON.parse(m, WORKER_JSON_REVIVER);
    setTimeout(() => {
      if (this.terminated) return;
      if (req.runId === this.opts.crashOnRun) {
        this.onerror?.({ message: 'boom' });
        return;
      }
      const res = handleChunk(req);
      this.onmessage?.({ data: JSON.stringify(res, WORKER_JSON_REPLACER) });
    }, this.opts.delay?.(req.chunkId) ?? 0);
  }

  terminate() {
    this.terminated = true;
  }
}

const setups = (n: number, prefix = 's'): BulkSetup[] => Array.from({ length: n }, (_, i) => ({
  id: `${prefix}${i}`,
  name: `${prefix}${i}`,
  player: generateEmptyPlayer(`${prefix}${i}`),
}));
const monsters = (n: number) => getMonsters().slice(0, n).map(monsterFromSearch);

describe('BulkPool', () => {
  test('runs every setup × monster once', async () => {
    const pool = new BulkPool({ size: 2, createWorker: () => new FakeWorker() });
    const progress: { done: number, total: number }[] = [];

    const rows = await pool.run(setups(3), monsters(4), (p) => progress.push({ done: p.done, total: p.total }));

    expect(rows).toHaveLength(12);
    expect(new Set(rows.map((r) => `${r.setupId}|${r.monsterId}`)).size).toBe(12);
    expect(progress[progress.length - 1]).toEqual({ done: 12, total: 12 });
  });

  test('spreads chunks across workers', async () => {
    const workers: FakeWorker[] = [];
    const pool = new BulkPool({
      size: 3,
      chunkSize: 2,
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
    });

    await pool.run(setups(3), monsters(4), () => {});

    expect(workers).toHaveLength(3);
    for (const w of workers) expect(w.received).toBeGreaterThan(0);
  });

  test('new run discards the old run', async () => {
    const pool = new BulkPool({ size: 2, chunkSize: 1, createWorker: () => new FakeWorker() });
    const bRows: string[][] = [];

    const a = pool.run(setups(3, 'a'), monsters(3), () => {});
    const b = pool.run(setups(2, 'b'), monsters(2), (p) => bRows.push(p.rows.map((r) => r.setupId)));

    await expect(a).rejects.toThrow('cancelled');
    const rows = await b;

    expect(rows).toHaveLength(4);
    for (const ids of [...bRows, rows.map((r) => r.setupId)]) {
      for (const id of ids) expect(id.startsWith('b')).toBe(true);
    }
  });

  test('zero jobs resolves immediately with [] and spawns no workers', async () => {
    let spawned = 0;
    const pool = new BulkPool({
      size: 2,
      createWorker: () => {
        spawned += 1;
        return new FakeWorker();
      },
    });

    await expect(pool.run([], monsters(2), () => {})).resolves.toEqual([]);
    expect(spawned).toBe(0);
  });

  test('spawns no more workers than there are chunks', async () => {
    let spawned = 0;
    const pool = new BulkPool({
      size: 4,
      createWorker: () => {
        spawned += 1;
        return new FakeWorker();
      },
    });

    await pool.run(setups(1), monsters(2), () => {});
    expect(spawned).toBe(1);
  });

  test('rows come back in setup × monster order even when chunks finish out of order', async () => {
    const pool = new BulkPool({
      size: 3,
      chunkSize: 1,
      // later chunks finish first
      createWorker: () => new FakeWorker({ delay: (chunkId) => (10 - chunkId) * 3 }),
    });

    const ms = monsters(3);
    const rows = await pool.run(setups(2), ms, () => {});

    const ids = ms.map((m) => m.id);
    expect(rows.map((r) => [r.setupId, r.monsterId])).toEqual([
      ['s0', ids[0]], ['s0', ids[1]], ['s0', ids[2]],
      ['s1', ids[0]], ['s1', ids[1]], ['s1', ids[2]],
    ]);
  });

  test('throttles progress updates but always reports the finished run', async () => {
    const pool = new BulkPool({
      size: 2, chunkSize: 1, progressInterval: 1e9, createWorker: () => new FakeWorker(),
    });
    const progress: number[] = [];

    await pool.run(setups(3), monsters(3), (p) => progress.push(p.done));

    expect(progress).toEqual([9]);
  });

  test("a worker crashing on a cancelled run's chunk doesn't fail the next run", async () => {
    let first = true;
    const pool = new BulkPool({
      size: 1,
      chunkSize: 1,
      createWorker: () => {
        // the first worker crashes on run 1, its replacement behaves
        const w = new FakeWorker(first ? { crashOnRun: 1 } : {});
        first = false;
        return w;
      },
    });

    const a = pool.run(setups(1, 'a'), monsters(1), () => {});
    const b = pool.run(setups(1, 'b'), monsters(2), () => {});

    await expect(a).rejects.toThrow('cancelled');
    await expect(b).resolves.toHaveLength(2);
  });
});
