import { computeRow, RowPart } from '@/bulk/lib/compute';
import { fullSetup } from '@/bulk/lib/slimSetup';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';
import { TaskChunk, TaskResult } from '@/bulk/worker/TaskPool';

export interface BulkPayload {
  setups: BulkSetup[];
  monsters: BulkMonster[];
  // [setup index, monster index] into this chunk's setups and monsters
  jobs: [number, number][];
  // compute only this part of each row; the setups then come slimmed (see slimSetup)
  only?: RowPart;
}

export type BulkChunkRequest = TaskChunk<BulkPayload>;

export type BulkChunkResponse = TaskResult<BulkRow>;

export const handleChunk = ({ runId, chunkId, payload }: BulkChunkRequest): BulkChunkResponse => {
  const { only } = payload;
  const setups = only ? payload.setups.map(fullSetup) : payload.setups;
  return {
    runId,
    chunkId,
    results: payload.jobs.map(([s, m]) => computeRow(setups[s], payload.monsters[m], only)),
  };
};
