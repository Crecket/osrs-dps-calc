/* eslint-disable no-restricted-globals */
import { BestPayload, BestResult, handleBestChunk } from '@/best/worker/protocol';
import { TaskChunk, TaskResult } from '@/bulk/worker/TaskPool';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';

self.onmessage = (evt: MessageEvent<string>) => {
  const { runId, chunkId, payload } = JSON.parse(evt.data, WORKER_JSON_REVIVER) as TaskChunk<BestPayload>;
  const res: TaskResult<BestResult> = { runId, chunkId, results: [handleBestChunk(payload)] };
  self.postMessage(JSON.stringify(res, WORKER_JSON_REPLACER));
};
