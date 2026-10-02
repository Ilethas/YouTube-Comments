import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createLiveExtractor } from './live-extraction';
import { ReaderRepository } from './persistence/reader-repository';
import { ReaderService } from './reader-service';
import type { ExecuteProcess, ProcessOutcome, ProcessRequest } from './helper-process';

const videoUrl = 'https://www.youtube.com/watch?v=VidDemo_001';
const postUrl = 'https://www.youtube.com/post/UgkDemoPost_0123456789';
const outcome = (stdout = '', exitCode = 0): ProcessOutcome => ({ status: 'exited', exitCode, stdout, stderr: '' });
async function raw(name: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(__dirname, 'extractors/__fixtures__', `${name}.json`), 'utf8')).raw;
}
let directory: string, repository: ReaderRepository;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), 'reader-live-test-')); repository = ReaderRepository.open(path.join(directory, 'reader.sqlite')); });
afterEach(async () => { repository.close(); await rm(directory, { recursive: true, force: true }); });
const resolver = vi.fn(async (name: string) => path.join(directory, `${name}.exe`));
function extractor(execute: ExecuteProcess) { return createLiveExtractor({ execute, resolve: resolver, temporaryRoot: directory }); }
function videoProcess(payload: Record<string, unknown>) {
  return vi.fn<ExecuteProcess>(async request => outcome(request.arguments.includes('--version') ? '2026.08.19\n' : JSON.stringify(payload)));
}

it('video fixture passes trusted builder, adapter, ingestion, repeat merge, seen edit, refresh and reopen', async () => {
  const payload = await raw('yt-nested-a'), execute = videoProcess(payload);
  const service = new ReaderService(() => repository, ['en'], vi.fn(), extractor(execute));
  const first = await service.dispatch('acquire', [{ url: `${videoUrl}&list=ignored` }]);
  if (!first.ok) throw new Error('Expected success');
  expect(first.value.summary).toMatchObject({ coverage: 'unknown', inserted: 3 });
  const itemId = first.value.summary.itemId, initial = first.value.state.comments[itemId];
  expect(initial.every(comment => !comment.seen)).toBe(true);
  const command = execute.mock.calls[1][0];
  expect(command.executable).toBe(path.join(directory, 'yt-dlp.exe'));
  expect(command.arguments).toEqual(['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--skip-download', '--dump-single-json', '--write-comments', '--socket-timeout', '15', '--retries', '2', '--extractor-retries', '2', '--', videoUrl]);
  service.dispatch('toggleSeen', [{ itemId, commentId: initial[0].id, subtree: false }]);
  // Second observation omits old comments, adds a new one and updates one remote text.
  const rows = payload.comments as Record<string, unknown>[];
  payload.comments = [{ ...rows[0], text: 'Updated remote text' }, { id: 'new-live-comment', text: 'New comment', parent: 'root' }];
  const second = await service.dispatch('acquire', [{ url: videoUrl }]);
  if (!second.ok) throw new Error('Expected success');
  expect(second.value.state.items).toHaveLength(1);
  expect(second.value.summary.itemId).toBe(itemId);
  expect(second.value.state.comments[itemId]).toHaveLength(4);
  expect(second.value.state.comments[itemId][0]).toMatchObject({ id: initial[0].id, seen: true, text: 'Updated remote text' });
  expect(second.value.state.comments[itemId][3].seen).toBe(false);
  const refresh = await service.dispatch('refresh', [{ itemId }]);
  expect(refresh.ok).toBe(true);
  repository.close();
  repository = ReaderRepository.open(path.join(directory, 'reader.sqlite'));
  expect(repository.bootstrap(['en']).comments[itemId][0].seen).toBe(true);
});

it('single lock rejects overlap while seen and preferences still succeed, reading current state at merge', async () => {
  const payload = await raw('yt-nested-a');
  let finish: (() => void) | undefined;
  const execute = videoProcess(payload);
  const service = new ReaderService(() => repository, ['en'], vi.fn(), extractor(execute));
  const first = await service.dispatch('acquire', [{ url: videoUrl }]);
  if (!first.ok) throw new Error('Expected success');
  execute.mockImplementation(async request => {
    if (request.arguments.includes('--version')) return outcome('2026.08.19');
    await new Promise<void>(resolve => { finish = resolve; });
    return outcome(JSON.stringify(payload));
  });
  const itemId = first.value.summary.itemId, id = first.value.state.comments[itemId][0].id;
  const pending = service.dispatch('refresh', [{ itemId }]);
  await vi.waitFor(() => expect(finish).toBeDefined());
  expect(await service.dispatch('acquire', [{ url: postUrl }])).toEqual({ ok: false, error: { code: 'ACQUISITION_BUSY' } });
  expect(await service.dispatch('refresh', [{ itemId }])).toEqual({ ok: false, error: { code: 'ACQUISITION_BUSY' } });
  expect(service.dispatch('toggleSeen', [{ itemId, commentId: id, subtree: false }]).ok).toBe(true);
  expect(service.dispatch('updatePreferences', [{ locale: 'pl' }]).ok).toBe(true);
  finish?.();
  const result = await pending;
  if (!result.ok) throw new Error('Expected success');
  expect(result.value.state.comments[itemId][0].seen).toBe(true);
  expect(result.value.state.preferences.locale).toBe('pl');
});

it.each(['missing', 'incompatible', 'unverified', 'nonzero', 'timeout', 'malformed', 'mismatch'] as const)('failed %s preserves the stored discussion and records only structured failure', async scenario => {
  const payload = await raw('yt-nested-a');
  const firstService = new ReaderService(() => repository, ['en'], vi.fn(), extractor(videoProcess(payload)));
  const first = await firstService.dispatch('acquire', [{ url: videoUrl }]);
  if (!first.ok) throw new Error('Expected success');
  const before = repository.bootstrap(['en']);
  const execute = vi.fn<ExecuteProcess>(async request => {
    if (request.arguments.includes('--version')) return outcome(scenario === 'incompatible' ? '2026.09.01' : scenario === 'unverified' ? 'a guess' : '2026.08.19');
    if (scenario === 'timeout') return { ...outcome(), status: 'timeout', stderr: 'private C:/path secret' };
    if (scenario === 'mismatch') return outcome(JSON.stringify({ ...payload, id: 'Another_001' }));
    return { ...outcome(scenario === 'malformed' ? '{' : JSON.stringify(payload), scenario === 'nonzero' ? 1 : 0), stderr: 'private C:/path secret' };
  });
  const extract = createLiveExtractor({ execute, resolve: async () => scenario === 'missing' ? undefined : 'trusted.exe' });
  const service = new ReaderService(() => repository, ['en'], vi.fn(), extract);
  const result = await service.dispatch('refresh', [{ itemId: first.value.summary.itemId }]);
  expect(result).toEqual({ ok: false, error: { code: scenario === 'missing' ? 'HELPER_UNAVAILABLE' : ['incompatible', 'unverified'].includes(scenario) ? 'HELPER_INCOMPATIBLE' : 'ACQUISITION_FAILED' } });
  expect(repository.bootstrap(['en'])).toEqual(before);
  const history = repository.history();
  expect(history.at(-1)?.outcome).toBe('failed');
  expect(JSON.stringify(history)).not.toContain('private');
  if (['missing', 'incompatible', 'unverified'].includes(scenario)) expect(execute.mock.calls.length).toBe(scenario === 'missing' ? 0 : 1);
});

it.each(['success', 'nonzero', 'timeout', 'missing', 'ambiguous', 'unexpected', 'malformed', 'throw'] as const)('Community %s uses anonymous workspace and cleans it', async scenario => {
  const payload = await raw('community-thread-a');
  const execute = vi.fn<ExecuteProcess>(async (request: ProcessRequest) => {
    if (request.arguments.includes('--version')) return outcome('post-archiver 0.4.0\n');
    expect(request.executable).toBe(path.join(directory, 'post-archiver.exe'));
    expect(request.environmentAdditions).toEqual({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    expect(request.arguments).not.toContain('--quiet');
    expect(request.arguments.at(-1)).toBe(postUrl);
    const output = request.arguments[request.arguments.indexOf('--output') + 1];
    const config = request.arguments[request.arguments.indexOf('--config') + 1];
    expect(request.arguments).toEqual(['--comments', '--output', output, '--config', config, '--max-comments', '1000', '--max-replies', '1000', '--timeout', '15', '--retries', '2', '--', postUrl]);
    expect(JSON.parse(await readFile(config, 'utf8'))).toEqual({ scraping: { cookies_file: null, download_images: false } });
    expect(path.dirname(output)).toBe(request.cwd);
    if (scenario === 'throw') throw new Error('private filesystem path');
    if (scenario !== 'missing') await writeFile(path.join(output, 'posts_unknown_20261003_120000.json'), scenario === 'malformed' ? '{' : JSON.stringify(payload));
    if (scenario === 'ambiguous') await writeFile(path.join(output, 'posts_unknown_20261003_120001.json'), JSON.stringify(payload));
    if (scenario === 'unexpected') await writeFile(path.join(output, 'arbitrary.json'), JSON.stringify(payload));
    if (scenario === 'timeout') return { ...outcome(), status: 'timeout' };
    return outcome('summary only', scenario === 'nonzero' ? 1 : 0);
  });
  const service = new ReaderService(() => repository, ['pl'], vi.fn(), extractor(execute));
  const result = await service.dispatch('acquire', [{ url: postUrl }]);
  if (scenario === 'success') {
    if (!result.ok) throw new Error('Expected success');
    expect(result.value.summary).toMatchObject({ coverage: 'partial', inserted: 4 });
    const comments = result.value.state.comments[result.value.summary.itemId];
    expect(comments.every(comment => !comment.seen)).toBe(true);
    expect(comments.some(comment => comment.relationship?.kind === 'thread-containment')).toBe(true);
    expect(await service.dispatch('refresh', [{ itemId: result.value.summary.itemId }])).toMatchObject({ ok: true, value: { summary: { inserted: 0 } } });
  } else {
    expect(result).toEqual({ ok: false, error: { code: 'ACQUISITION_FAILED' } });
    expect(repository.bootstrap(['en']).items).toHaveLength(0);
  }
  expect((await readdir(directory)).filter(name => name.startsWith('youtube-comments-acquisition-'))).toEqual([]);
});

it('verifies the selected Community executable conservatively before trusting output', async () => {
  for (const stdout of ['post-archiver 0.5.0', '0.4.0', 'post-archiver 0.4.0 extra']) {
    const execute = vi.fn<ExecuteProcess>(async () => outcome(stdout));
    const result = await extractor(execute)({ sourceKind: 'youtube-community-post', sourceId: 'UgkDemoPost_0123456789', url: postUrl }, new AbortController().signal);
    expect(result.error).toBe('HELPER_INCOMPATIBLE');
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0].arguments).toEqual(['--version']);
  }
});

it('counts probe time in the overall deadline and refuses output completed after it', async () => {
  const payload = await raw('yt-nested-a');
  let now = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  try {
    const execute = vi.fn<ExecuteProcess>(async request => {
      if (request.arguments.includes('--version')) { now = 40; return outcome('2026.08.19'); }
      expect(request.timeoutMs).toBe(60);
      now = 101;
      return outcome(JSON.stringify(payload));
    });
    const extract = createLiveExtractor({ execute, resolve: resolver, deadlineMs: 100 });
    const result = await extract({ sourceKind: 'youtube-video', sourceId: 'VidDemo_001', url: videoUrl }, new AbortController().signal);
    expect(execute.mock.calls[0][0].timeoutMs).toBe(100);
    expect(result).toMatchObject({ error: 'ACQUISITION_FAILED', extraction: { coverage: { kind: 'failed', reason: 'execution-deadline-or-shutdown' } } });
  } finally { clock.mockRestore(); }
});

it('child ENOENT maps to helper unavailable and helper warnings conservatively downgrade coverage', async () => {
  const payload = await raw('yt-nested-a');
  const execute = videoProcess(payload);
  execute.mockResolvedValueOnce({ ...outcome(), status: 'unavailable' });
  const service = new ReaderService(() => repository, ['en'], vi.fn(), extractor(execute));
  expect(await service.dispatch('acquire', [{ url: videoUrl }])).toMatchObject({ error: { code: 'HELPER_UNAVAILABLE' } });
  execute.mockImplementation(async request => request.arguments.includes('--version') ? outcome('2026.08.19')
    : { ...outcome(JSON.stringify(payload)), stderr: 'WARNING: arbitrary path C:/private/file' });
  const result = await service.dispatch('acquire', [{ url: videoUrl }]);
  expect(result).toMatchObject({ ok: true, value: { summary: { coverage: 'partial' } } });
  expect(JSON.stringify(repository.history())).not.toContain('private');
});

it('shutdown aborts pending extraction, awaits cleanup, and never ingests after shutdown', async () => {
  let started = false;
  const extract = vi.fn(async (_target, signal: AbortSignal) => {
    started = true;
    await new Promise<void>(resolve => signal.addEventListener('abort', () => resolve(), { once: true }));
    return { extraction: { provenance: { backend: 'yt-dlp', version: 'unverified', evidence: [] }, issues: [], coverage: { kind: 'failed' as const, reason: 'aborted' } } };
  });
  const service = new ReaderService(() => repository, ['en'], vi.fn(), extract);
  const pending = service.dispatch('acquire', [{ url: videoUrl }]);
  expect(started).toBe(true);
  await service.shutdown();
  expect(await pending).toMatchObject({ error: { code: 'ACQUISITION_FAILED' } });
  repository = ReaderRepository.open(path.join(directory, 'reader.sqlite'));
  expect(repository.history()).toEqual([]);
});

it('validates exact acquisition payloads and refuses missing/synthetic refresh without executing', async () => {
  repository.initializeDemo();
  const execute = vi.fn<ExecuteProcess>();
  const service = new ReaderService(() => repository, ['en'], vi.fn(), extractor(execute));
  for (const payload of [null, {}, { url: videoUrl, executable: 'evil' }, { url: videoUrl, args: [] }, { url: videoUrl, env: {} }, { url: videoUrl, path: 'file' }]) {
    expect(await service.dispatch('acquire', [payload])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  }
  for (const payload of [{ itemId: 'video-demo', url: videoUrl }, { itemId: 'video-demo', output: 'file' }, {}]) {
    expect(await service.dispatch('refresh', [payload])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  }
  expect(await service.dispatch('acquire', [])).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(await service.dispatch('refresh', [{ itemId: 'missing' }])).toMatchObject({ error: { code: 'NOT_FOUND' } });
  expect(await service.dispatch('refresh', [{ itemId: 'video-demo' }])).toMatchObject({ error: { code: 'NOT_REFRESHABLE' } });
  expect(execute).not.toHaveBeenCalled();
});
