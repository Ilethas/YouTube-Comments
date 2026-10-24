import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLiveExtractor } from './live-extraction';
import { DownloadManager } from './download-manager';
import { ReaderRepository } from './persistence/reader-repository';
import type { ExecuteProcess, ProcessOutcome } from './helper-process';
import { executeProcess } from './helper-process';
import { downloadPending } from '../shared/downloads';

let root: string, repo: ReaderRepository, manager: DownloadManager | undefined;
const outcome = (stdout = ''): ProcessOutcome => ({ status: 'exited', exitCode: 0, stdout, stderr: '' });
const url = (id: string) => `https://www.youtube.com/watch?v=${id}`;
const target = { sourceKind: 'youtube-video' as const, sourceId: 'VidDemo_001', url: url('VidDemo_001') };
const wait = async (check: () => boolean) => vi.waitFor(() => expect(check()).toBe(true), { interval: 10 });
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), 'reader-title-')); repo = ReaderRepository.open(path.join(root, 'reader.sqlite')); });
afterEach(async () => { await manager?.close(); manager = undefined; repo.close(); await rm(root, { recursive: true, force: true }); });
const fixture = async () => JSON.parse(await readFile(path.join(__dirname, 'extractors/__fixtures__/yt-nested-a.json'), 'utf8'));
const extractor = (execute: ExecuteProcess) => createLiveExtractor({ execute, resolve: async () => 'yt-dlp.exe', temporaryRoot: root });
const workspaces = async () => (await readdir(root)).filter(f => f.startsWith('youtube-comments-acquisition-'));

it('reads distinct early titles during concurrent children, coexists with progress and awaits cancellation cleanup', async () => {
  const data = await fixture(), releases = new Map<string, () => void>(), files: string[] = [];
  const execute = vi.fn<ExecuteProcess>(async request => {
    if (request.arguments.includes('--version')) return outcome('2026.08.19');
    const id = new URL(request.arguments.at(-1) ?? '').searchParams.get('v') ?? '';
    const file = request.arguments[request.arguments.indexOf('--print-to-file') + 2]; files.push(file);
    expect(path.dirname(file)).toBe(request.cwd);
    await writeFile(file, JSON.stringify(`  <title ${id}>\n\u202eZażółć  `));
    request.onStderr?.(Buffer.from('[youtube] Downloading comment API JSON page 1 (10/~20)\n'));
    await new Promise<void>(resolve => { releases.set(id, resolve); request.signal?.addEventListener('abort', () => resolve(), { once: true }); });
    return outcome(JSON.stringify({ ...data.raw, id }));
  });
  manager = new DownloadManager(repo, ['en'], extractor(execute));
  for (const id of ['VidDemo_001', 'VidDemo_002']) expect(manager.submit({ kind: 'acquire', url: url(id) }).ok).toBe(true);
  const jobs = () => manager?.snapshot().jobs ?? [];
  await wait(() => jobs().every(j => j.label.startsWith('<title')));
  expect(jobs().map(j => j.label)).toEqual(['<title VidDemo_001>  Zażółć', '<title VidDemo_002>  Zażółć']);
  expect(jobs().every(j => j.state === 'fetching' && j.comments?.fetched === 10)).toBe(true);
  expect(repo.history()).toEqual([]);
  expect(new Set(files).size).toBe(2); expect(await workspaces()).toHaveLength(2);
  const cancelled = jobs()[1]; manager.cancel(cancelled.operationId);
  await wait(() => jobs()[1].state === 'cancelled');
  expect(await workspaces()).toHaveLength(1);
  releases.get('VidDemo_001')?.(); await wait(() => jobs().every(j => !downloadPending(j)));
  expect(await workspaces()).toEqual([]); expect(execute).toHaveBeenCalledTimes(4); // one existing probe + extraction per job
  expect(repo.bootstrap(['en']).items).toHaveLength(1);
});

it.each([undefined, '', '{', 'null', '123', '{}', '[]', '""', '"\\u0000\\n"', '"' + 'x'.repeat(9000) + '"', Buffer.from([0xff])])('ignores missing/malformed/oversized metadata %j without failing final extraction', async content => {
  const data = await fixture(), titles: string[] = [];
  const result = await extractor(async request => {
    if (request.arguments.includes('--version')) return outcome('2026.08.19');
    if (content !== undefined) await writeFile(path.join(request.cwd ?? '', 'title.json'), content);
    return outcome(JSON.stringify(data.raw));
  })(target, new AbortController().signal, undefined, undefined, title => titles.push(title));
  expect(result.error).toBeUndefined(); expect(titles).toEqual([]); expect(await workspaces()).toEqual([]);
});

it.each(['throw', 'failed', 'aborted'] as const)('cleans the title workspace after %s', async failure => {
  const controller = new AbortController(), titles: string[] = [];
  const result = await extractor(async request => {
    if (request.arguments.includes('--version')) return outcome('2026.08.19');
    await writeFile(path.join(request.cwd ?? '', 'title.json'), JSON.stringify('Early title'));
    if (failure === 'throw') throw Error('fixture');
    if (failure === 'aborted') controller.abort();
    return { ...outcome(), status: 'failed' };
  })(target, controller.signal, undefined, undefined, title => titles.push(title));
  expect(result.error).toBe('ACQUISITION_FAILED'); expect(await workspaces()).toEqual([]);
  if (failure === 'aborted') expect(titles).toEqual([]);
});

it('continues with the original JSON-only invocation when the optional workspace is unavailable', async () => {
  const data = await fixture();
  const execute = vi.fn<ExecuteProcess>(async request => {
    if (request.arguments.includes('--version')) return outcome('2026.08.19');
    expect(request.arguments).not.toContain('--print-to-file'); expect(request.cwd).toBeUndefined();
    return outcome(JSON.stringify(data.raw));
  });
  const result = await createLiveExtractor({ execute, resolve: async () => 'yt-dlp.exe', temporaryRoot: path.join(root, 'missing') })(target, new AbortController().signal);
  expect(result.error).toBeUndefined(); expect(execute).toHaveBeenCalledTimes(2); expect(await workspaces()).toEqual([]);
});

it('retries incomplete JSON but delivers at most one sanitized title', async () => {
  const data = await fixture(), titles: string[] = [];
  const result = await extractor(async request => {
    if (request.arguments.includes('--version')) return outcome('2026.08.19');
    const file = path.join(request.cwd ?? '', 'title.json');
    await writeFile(file, '"partial'); await new Promise(resolve => setTimeout(resolve, 130)); expect(titles).toEqual([]);
    await writeFile(file, JSON.stringify('Early title')); await wait(() => titles.length === 1);
    await writeFile(file, JSON.stringify('Other title')); return outcome(JSON.stringify(data.raw));
  })(target, new AbortController().signal, undefined, undefined, title => titles.push(title));
  expect(result.error).toBeUndefined(); expect(titles).toEqual(['Early title']); expect(await workspaces()).toEqual([]);
});

it.each([false, true])('observes a real helper child title before completion and drains its workspace on cancel=%s', async cancel => {
  const data = await fixture(), controller = new AbortController(), titles: string[] = [];
  const helper = path.join(root, 'helper.cjs'), release = path.join(root, 'release');
  await writeFile(helper, `
    const fs=require('node:fs'), args=process.argv.slice(2);
    if(args.includes('--version')) { process.stdout.write('2026.08.19'); process.exit(0); }
    fs.appendFileSync(args[args.indexOf('--print-to-file')+2], JSON.stringify('Real child title')+'\\n');
    process.stderr.write('[youtube] Downloading comment API JSON page 1 (10/~20)\\n');
    const timer=setInterval(()=>{if(fs.existsSync(${JSON.stringify(release)})){
      clearInterval(timer);process.stdout.write(${JSON.stringify(JSON.stringify(data.raw))});
    }},20);
  `);
  const counts: number[] = [];
  const pending = extractor(request => executeProcess({ ...request, executable: process.execPath, arguments: [helper, ...request.arguments] }))(
    target, controller.signal, undefined, value => counts.push(value.fetched), title => titles.push(title));
  try {
    await wait(() => titles.length === 1);
    expect(titles).toEqual(['Real child title']); expect(counts).toEqual([10]); expect(await workspaces()).toHaveLength(1);
    if (cancel) controller.abort(); else await writeFile(release, 'done');
    const result = await pending;
    expect(result.error).toBe(cancel ? 'ACQUISITION_FAILED' : undefined);
    expect(await workspaces()).toEqual([]);
  } finally { controller.abort(); await pending; }
});
