import type { DiscussionQuery, QueryComment, QueryOutcome } from '../domain/discussion-query';

export interface QueryWorkerPort {
  postMessage(message: QueryRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<QueryReply>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export interface QueryRequest { readonly id: number; readonly comments: readonly QueryComment[]; readonly query: DiscussionQuery }
export interface QueryReply { readonly id: number; readonly outcome: QueryOutcome }
export interface QueryExecutor {
  evaluate(comments: readonly QueryComment[], query: DiscussionQuery): Promise<QueryOutcome>;
  dispose(): void;
}
/** A whole-query deadline, including dispatch, prevents regex from blocking the reader.
 * Each executor belongs to one singleton discussion view. Supersession kills pending work. */
export class QueryWorkerClient implements QueryExecutor {
  private worker?: QueryWorkerPort;
  private pending?: { id: number; finish: (outcome: QueryOutcome) => void; timer: ReturnType<typeof setTimeout>; deadline: number };
  private sequence = 0;
  constructor(private readonly create: () => QueryWorkerPort, private readonly deadlineMs = 1000,
    private readonly now: () => number = () => performance.now()) {}

  evaluate(comments: readonly QueryComment[], query: DiscussionQuery): Promise<QueryOutcome> {
    this.cancel('QUERY_CANCELLED');
    return new Promise(resolve => {
      const id = ++this.sequence;
      const timer = setTimeout(() => this.cancel('QUERY_TOO_EXPENSIVE'), this.deadlineMs);
      this.pending = { id, finish: resolve, timer, deadline: this.now() + this.deadlineMs };
      try {
        const worker = this.worker ??= this.create();
        worker.onmessage = ({ data }) => {
          if (this.worker !== worker || this.pending?.id !== data.id) return;
          if (this.now() >= this.pending.deadline) { this.cancel('QUERY_TOO_EXPENSIVE'); return; }
          const pending = this.pending; this.pending = undefined;
          clearTimeout(pending.timer); pending.finish(data.outcome);
        };
        worker.onerror = () => { if (this.worker === worker) this.cancel('QUERY_FAILED'); };
        worker.postMessage({ id, comments, query });
      } catch { this.cancel('QUERY_FAILED'); }
    });
  }
  private cancel(error: 'QUERY_CANCELLED' | 'QUERY_TOO_EXPENSIVE' | 'QUERY_FAILED') {
    if (!this.pending) return;
    const pending = this.pending; this.pending = undefined;
    clearTimeout(pending.timer);
    this.worker?.terminate(); this.worker = undefined;
    pending.finish({ ok: false, error });
  }
  dispose(): void { this.cancel('QUERY_CANCELLED'); this.worker?.terminate(); this.worker = undefined; }
}
