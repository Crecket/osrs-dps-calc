import { computeRow } from '@/bulk/lib/compute';
import { BulkMonster, BulkRow, BulkSetup } from '@/bulk/types';

export interface BulkChunkRequest {
  runId: number;
  chunkId: number;
  setups: BulkSetup[];
  monsters: BulkMonster[];
  // [setup index, monster index] into this chunk's setups and monsters
  jobs: [number, number][];
}

export interface BulkChunkResponse {
  runId: number;
  chunkId: number;
  rows: BulkRow[];
}

export const handleChunk = (req: BulkChunkRequest): BulkChunkResponse => ({
  runId: req.runId,
  chunkId: req.chunkId,
  rows: req.jobs.map(([s, m]) => computeRow(req.setups[s], req.monsters[m])),
});
