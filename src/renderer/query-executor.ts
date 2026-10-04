// Vite emits a separate same-origin worker asset in development and built readers.
// eslint-disable-next-line import/no-unresolved
import DiscussionWorker from './discussion-query.worker?worker';
import { QueryWorkerClient } from './query-worker-client';
import type { QueryExecutor } from './query-worker-client';
export const createQueryExecutor = (): QueryExecutor => new QueryWorkerClient(() => new DiscussionWorker());
