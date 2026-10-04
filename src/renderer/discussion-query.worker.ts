import { evaluateDiscussionQuery } from '../domain/discussion-query';
import type { QueryReply, QueryRequest } from './query-worker-client';

// Dedicated browser worker: no preload, Node, extractor, persistence or DOM imports.
const scope = self as unknown as { onmessage: (event: MessageEvent<QueryRequest>) => void; postMessage(reply: QueryReply): void };
scope.onmessage = ({ data }) => {
  try { scope.postMessage({ id: data.id, outcome: evaluateDiscussionQuery(data.comments, data.query) }); }
  catch { scope.postMessage({ id: data.id, outcome: { ok: false, error: 'QUERY_FAILED' } }); }
};
