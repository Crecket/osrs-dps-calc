import { WorkerLike } from '@/bulk/worker/BulkPool';

// Kept separate from BulkPool so that tests never have to compile `import.meta`.
const createBulkWorker = (): WorkerLike => new Worker(new URL('./bulkWorker.ts', import.meta.url)) as unknown as WorkerLike;

export default createBulkWorker;
