import { defaultResolvedQuery as defaultQuery } from '../fixtures/query-testing';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryWorkerClient } from './query-worker-client';
import type { QueryReply, QueryRequest, QueryWorkerPort } from './query-worker-client';
import { evaluateDiscussionQuery, queryComments } from '../domain/discussion-query';
import { initialComments } from '../fixtures/discussions';

class FakeWorker implements QueryWorkerPort {
  onmessage: QueryWorkerPort['onmessage'] = null;
  onerror: QueryWorkerPort['onerror'] = null;
  terminate = vi.fn();
  request?: QueryRequest;
  postMessage(request: QueryRequest) { this.request = request; }
  reply() {
    if (!this.request) throw new Error('No request');
    this.onmessage?.({ data: { id: this.request.id, outcome: evaluateDiscussionQuery(this.request.comments, this.request.query) } } as MessageEvent<QueryReply>);
  }
}
const comments = queryComments(initialComments['video-demo']);
function setup() {
  vi.useFakeTimers();
  const workers: FakeWorker[] = [];
  const client = new QueryWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 20, () => Date.now());
  return { workers, client };
}
afterEach(() => vi.useRealTimers());
it.each([{ ...defaultQuery, text: 'desk' }, { ...defaultQuery, mode: 'regex' as const, text: '\\p{L}+' }, { ...defaultQuery, mode: 'regex' as const, text: '[' }])('returns full ordinary/regex/invalid results through serialized boundary', async query => {
  const { client, workers } = setup();
  const pending = client.evaluate(comments, query); workers[0].reply();
  await expect(pending).resolves.toEqual(evaluateDiscussionQuery(comments, query)); client.dispose();
});
it('times out whole query, kills/recreates worker, rejects late partial response and permits next query', async () => {
  const { client, workers } = setup();
  const pending = client.evaluate(comments, { ...defaultQuery, text: '(a+)+$', mode: 'regex' });
  await vi.advanceTimersByTimeAsync(20);
  expect(await pending).toEqual({ ok: false, error: 'QUERY_TOO_EXPENSIVE' });
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  const next = client.evaluate(comments, defaultQuery);
  // Simulate a stale/partial result after termination without running a pathological regex.
  workers[0].onmessage?.({ data: { id: 1, outcome: { ok: true, result: { ...evaluateDiscussionQuery([], defaultQuery), matchCount: 1 } } } } as unknown as MessageEvent<QueryReply>);
  workers[1].reply();
  expect(await next).toEqual(evaluateDiscussionQuery(comments, defaultQuery));
  client.dispose();
});
it('new Apply supersedes and terminates older evaluation; stale response cannot overwrite newer one', async () => {
  const { client, workers } = setup();
  const old = client.evaluate(comments, defaultQuery);
  const next = client.evaluate(comments, { ...defaultQuery, text: 'missing' });
  expect(await old).toEqual({ ok: false, error: 'QUERY_CANCELLED' });
  expect(workers[0].terminate).toHaveBeenCalledOnce();
  workers[0].reply(); workers[1].reply();
  expect(await next).toEqual(evaluateDiscussionQuery(comments, { ...defaultQuery, text: 'missing' }));
  client.dispose();
});
it('rejects a result past deadline even before timer callback executes', async () => {
  const { client, workers } = setup();
  const pending = client.evaluate(comments, defaultQuery);
  vi.setSystemTime(Date.now() + 21); workers[0].reply();
  expect(await pending).toEqual({ ok: false, error: 'QUERY_TOO_EXPENSIVE' }); client.dispose();
});
it('worker creation/post/error failures retain explicit failure and recover with a fresh worker', async () => {
  const client = new QueryWorkerClient(() => { throw new Error('unavailable'); });
  expect(await client.evaluate(comments, defaultQuery)).toEqual({ ok: false, error: 'QUERY_FAILED' });
  client.dispose();
  const setupResult = setup();
  const pending = setupResult.client.evaluate(comments, defaultQuery);
  setupResult.workers[0].onerror?.({} as ErrorEvent);
  expect(await pending).toEqual({ ok: false, error: 'QUERY_FAILED' });
  expect(setupResult.workers[0].terminate).toHaveBeenCalledOnce(); setupResult.client.dispose();
});
it('worker compares serialized numeric publication bounds and NEW without reading clock or timezone', async () => {
  const workers: FakeWorker[] = [];
  const client = new QueryWorkerClient(() => { const worker = new FakeWorker(); workers.push(worker); return worker; }, 1000, () => 0);
  const rows = [{ id: 'match', itemId: 'item', parentId: null, text: '', seen: true, publicationInstant: 100, newDiscovery: true },
    { id: 'upper', itemId: 'item', parentId: null, text: '', seen: true, publicationInstant: 200, newDiscovery: true }];
  const query = { ...defaultQuery, publicationBounds: { from: 100, to: 200, toInclusive: false }, discovery: 'new' as const };
  const pending = client.evaluate(rows, query);
  const sent = workers[0].request;
  expect(sent?.query).not.toHaveProperty('publication');
  expect(sent?.query.publicationBounds).toEqual(query.publicationBounds);
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('Ambient worker clock'); });
  try { workers[0].reply(); } finally { clock.mockRestore(); }
  const outcome = await pending;
  expect(outcome.ok && outcome.result.activeMatchIds).toEqual(['match']); client.dispose();
});
