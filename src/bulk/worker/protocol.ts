import { computeRow } from '@/bulk/lib/compute';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';
import { TaskChunk, TaskResult } from '@/bulk/worker/TaskPool';

export interface BulkPayload {
  setups: BulkSetup[];
  monsters: BulkMonster[];
  // [setup index, monster index] into this chunk's setups and monsters
  jobs: [number, number][];
}

export type BulkChunkRequest = TaskChunk<BulkPayload>;

export type BulkChunkResponse = TaskResult<BulkRow>;

export const handleChunk = ({ runId, chunkId, payload }: BulkChunkRequest): BulkChunkResponse => ({
  runId,
  chunkId,
  results: payload.jobs.map(([s, m]) => computeRow(payload.setups[s], payload.monsters[m])),
});
