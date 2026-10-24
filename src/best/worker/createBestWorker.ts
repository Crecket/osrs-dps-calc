import { WorkerLike } from '@/bulk/worker/TaskPool';

// Kept separate from the pool so that tests never have to compile `import.meta`.
const createBestWorker = (): WorkerLike => new Worker(new URL('./bestWorker.ts', import.meta.url)) as unknown as WorkerLike;

export default createBestWorker;
