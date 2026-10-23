/* eslint-disable no-restricted-globals */
import { BulkChunkRequest, handleChunk } from '@/bulk/worker/protocol';
import { WORKER_JSON_REPLACER, WORKER_JSON_REVIVER } from '@/utils';

self.onmessage = (evt: MessageEvent<string>) => {
  const req = JSON.parse(evt.data, WORKER_JSON_REVIVER) as BulkChunkRequest;
  const res = handleChunk(req);
  self.postMessage(JSON.stringify(res, WORKER_JSON_REPLACER));
};
