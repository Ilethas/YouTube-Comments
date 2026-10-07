import { defaultResolvedQuery as defaultQuery } from '../fixtures/query-testing';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import ts from 'typescript';
import { afterEach, expect, it, vi } from 'vitest';
import { QueryWorkerClient } from './query-worker-client';
import type { QueryWorkerPort } from './query-worker-client';

// Execute the actual browser handler and pure evaluator in an isolated test thread.
// The Node adapter exists only in tests; the shipped worker has no Node imports.
const sources = ['src/domain/discussion.ts', 'src/domain/publication-predicate.ts', 'src/domain/discussion-query.ts', 'src/renderer/discussion-query.worker.ts'];
const modules = sources.map(file => {
  const code = ts.transpileModule(readFileSync(path.resolve(file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return `${JSON.stringify(path.basename(file, '.ts'))}: function(exports, require) { ${code} }`;
}).join(',');
const program = `const {parentPort} = require('node:worker_threads');
const modules = {${modules}}, cache = {};
function load(name) { const key = name.split('/').pop(); if (!cache[key]) { const exports = cache[key] = {}; modules[key](exports, load); } return cache[key]; }
global.self = { postMessage: reply => parentPort.postMessage(reply) };
load('discussion-query.worker');
parentPort.on('message', data => { parentPort.postMessage({started:true}); self.onmessage({data}); });
parentPort.postMessage({ready:true});`;
const threads: Worker[] = [];
afterEach(async () => { vi.useRealTimers(); await Promise.all(threads.splice(0).map(thread => thread.terminate())); });
it('actual catastrophic regex is isolated, forcibly terminated on injected deadline, and next worker completes ordinary/regex queries', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let start: () => void = () => undefined;
  const started = new Promise<void>(resolve => { start = resolve; });
  let creations = 0, terminations = 0;
  const client = new QueryWorkerClient(() => {
    creations++;
    const thread = new Worker(program, { eval: true }); threads.push(thread);
    const port: QueryWorkerPort = { onmessage: null, onerror: null,
      postMessage: data => thread.postMessage(data), terminate: () => { terminations++; void thread.terminate(); } };
    thread.on('message', data => {
      if (data.started) start();
      else if (!data.ready) port.onmessage?.({ data } as MessageEvent);
    });
    thread.on('error', () => port.onerror?.({} as ErrorEvent));
    return port;
  }, 25, () => 0);
  const rows = [{ id: 'root', itemId: 'item', parentId: null, seen: false, text: 'a'.repeat(50000) + '!' }];
  const pending = client.evaluate(rows, { ...defaultQuery, text: '(a+)+$', mode: 'regex' });
  await started; // Begin only once the thread is actually evaluating, avoiding startup races.
  await vi.advanceTimersByTimeAsync(25);
  expect(await pending).toEqual({ ok: false, error: 'QUERY_TOO_EXPENSIVE' });
  expect(terminations).toBe(1);
  const ordinary = await client.evaluate(rows, { ...defaultQuery, text: '!' });
  expect(ordinary.ok && ordinary.result.activeMatchIds).toEqual(['root']);
  expect(creations).toBe(2);
  const regex = await client.evaluate(rows, { ...defaultQuery, text: '!$', mode: 'regex' });
  expect(regex.ok && regex.result.matchCount).toBe(1);
  client.dispose();
});
