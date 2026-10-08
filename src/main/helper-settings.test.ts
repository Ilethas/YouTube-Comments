import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HelperSettingsService } from './helper-settings';
import { ReaderRepository } from './persistence/reader-repository';
import { migrations, migrateDatabase } from './persistence/migrations';
import { isHelperExecutable } from './helper-process';
import type { ExecuteProcess, ProcessOutcome } from './helper-process';
import { ReaderService } from './reader-service';

let directory: string, file: string, repository: ReaderRepository;
const services: HelperSettingsService[] = [];
const output = (stdout: string): ProcessOutcome => ({ status: 'exited', exitCode: 0, stdout, stderr: 'private diagnostic' });
const execute = vi.fn<ExecuteProcess>(async request => output(request.executable.includes('post') ? 'post-archiver 0.4.0' : '2026.08.19'));
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'reader-helper-test-'));
  file = path.join(directory, 'reader.sqlite'); repository = ReaderRepository.open(file);
  execute.mockClear();
  execute.mockImplementation(async request => output(request.executable.includes('post') ? 'post-archiver 0.4.0' : '2026.08.19'));
  for (const name of ['yt-dlp', 'post-archiver', 'custom', 'custom-post', 'environment', 'bad']) await writeFile(path.join(directory, `${name}.exe`), 'test-only placeholder');
});
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.shutdown())); repository.close();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('reader-helper-test-')) throw new Error('Unsafe cleanup');
  await rm(directory, { recursive: true, force: true });
});
function helper(environment: NodeJS.ProcessEnv = { PATH: directory }, choose = vi.fn(async () => path.join(directory, 'custom.exe'))) {
  const service = new HelperSettingsService(repository, { environment, platform: 'win32', execute, choose });
  services.push(service); return service;
}
function reopen() { repository.close(); repository = ReaderRepository.open(file); }

it('environment > saved > PATH, captures startup authority, and never persists overrides', async () => {
  const custom = path.join(directory, 'custom.exe'), override = path.join(directory, 'environment.exe');
  repository.setHelperSelection('yt-dlp', custom);
  const environment = { PATH: directory, YOUTUBE_COMMENTS_YTDLP_EXE: override }, choose = vi.fn();
  const env = helper(environment, choose); environment.YOUTUBE_COMMENTS_YTDLP_EXE = 'missing.exe';
  expect(await env.resolve('yt-dlp')).toBe(override);
  expect(await env.getStatus('yt-dlp')).toMatchObject({ value: { mode: 'environment', path: override, state: 'ready', version: '2026.08.19' } });
  expect(await env.choose('yt-dlp')).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(await env.clear('yt-dlp')).toMatchObject({ error: { code: 'FORBIDDEN' } });
  expect(choose).not.toHaveBeenCalled(); expect(repository.getHelperSelection('yt-dlp')).toBe(custom);
  const configured = helper(); expect(await configured.resolve('yt-dlp')).toBe(custom);
  expect(await configured.getStatus('yt-dlp')).toMatchObject({ value: { mode: 'configured', state: 'ready' } });
  expect(await configured.clear('yt-dlp')).toMatchObject({ value: { mode: 'PATH', path: path.join(directory, 'yt-dlp.exe'), state: 'ready' } });
  expect(repository.getHelperSelection('yt-dlp')).toBeUndefined();
  expect(await env.getStatus('post-archiver')).toMatchObject({ value: { mode: 'PATH', state: 'ready', version: '0.4.0' } });
  expect(repository.getHelperSelection('post-archiver')).toBeUndefined();
});

it('invalid environment and broken saved paths fail closed, including empty overrides', async () => {
  repository.setHelperSelection('yt-dlp', path.join(directory, 'custom.exe'));
  for (const invalid of ['', 'relative.exe', path.join(directory, 'missing.exe')]) {
    const env = helper({ PATH: directory, YOUTUBE_COMMENTS_YTDLP_EXE: invalid });
    expect(await env.resolve('yt-dlp')).toBeUndefined();
    expect(await env.getStatus('yt-dlp')).toMatchObject({ value: { mode: 'environment', state: 'invalid-path', path: invalid } });
  }
  repository.setHelperSelection('yt-dlp', path.join(directory, 'missing.exe'));
  const service = helper();
  expect(await service.resolve('yt-dlp')).toBeUndefined();
  expect(await service.getStatus('yt-dlp')).toMatchObject({ value: { mode: 'configured', state: 'invalid-path' } });
  expect(execute).not.toHaveBeenCalled();
  await service.clear('yt-dlp'); expect(await service.resolve('yt-dlp')).toBe(path.join(directory, 'yt-dlp.exe'));
});

it('rejects relative, missing, directory and batch paths; accepts regular absolute .exe only on Windows', async () => {
  await mkdir(path.join(directory, 'folder.exe'));
  for (const extension of ['bat', 'cmd', 'txt']) await writeFile(path.join(directory, `wrapper.${extension}`), 'ignored');
  const invalid = ['custom.exe', '', '\\root-relative.exe', 'C:relative.exe', directory, path.join(directory, 'folder.exe'), path.join(directory, 'missing.exe'),
    ...['bat', 'cmd', 'txt'].map(extension => path.join(directory, `wrapper.${extension}`))];
  const choose = vi.fn(async () => ''), service = helper({ PATH: directory }, choose);
  repository.setHelperSelection('yt-dlp', path.join(directory, 'custom.exe'));
  for (const name of invalid) {
    expect(await isHelperExecutable(name, 'win32')).toBe(false);
    choose.mockResolvedValueOnce(name);
    expect(await service.choose('yt-dlp')).toMatchObject({ error: { code: 'HELPER_UNAVAILABLE' } });
    expect(repository.getHelperSelection('yt-dlp')).toBe(path.join(directory, 'custom.exe'));
  }
  expect(execute).not.toHaveBeenCalled();
  expect(await isHelperExecutable(path.join(directory, 'custom.exe'), 'win32')).toBe(true);
});

it.each(['yt-dlp', 'post-archiver'] as const)('exact %s probe rejects incompatible/unverified output, retains prior selection, and exposes no diagnostics', async kind => {
  const previous = path.join(directory, kind === 'yt-dlp' ? 'custom.exe' : 'custom-post.exe');
  repository.setHelperSelection(kind, previous);
  const service = helper({}, vi.fn(async () => path.join(directory, 'bad.exe')));
  for (const version of ['private garbage output', kind === 'yt-dlp' ? '2026.09.01' : 'post-archiver 0.4.1']) {
    execute.mockResolvedValueOnce(output(version));
    expect(await service.choose(kind)).toEqual({ ok: false, error: { code: 'HELPER_INCOMPATIBLE' } });
    expect(repository.getHelperSelection(kind)).toBe(previous);
  }
  execute.mockResolvedValueOnce(output(kind === 'yt-dlp' ? '2026.08.19' : 'post-archiver 0.4.0'));
  expect(await service.choose(kind)).toMatchObject({ ok: true, value: { state: 'ready' } });
  execute.mockResolvedValueOnce(output(kind === 'yt-dlp' ? '2026.09.01' : 'post-archiver 0.4.1'));
  const status = await service.getStatus(kind);
  expect(status).toMatchObject({ value: { mode: 'configured', state: 'incompatible' } });
  expect(JSON.stringify(status)).not.toContain('private');
  expect(execute.mock.calls[0][0]).toMatchObject({ arguments: kind === 'yt-dlp' ? ['--ignore-config', '--no-plugin-dirs', '--version'] : ['--version'], timeoutMs: 10000, maxStdoutBytes: 4096 });
});

it('cancel is a successful no-op; failures/timeouts retain settings and status is sanitized', async () => {
  const selected = path.join(directory, 'custom.exe'); repository.setHelperSelection('yt-dlp', selected);
  const service = new HelperSettingsService(repository, { platform: 'win32', environment: {}, execute, choose: async () => undefined }); services.push(service);
  expect(await service.choose('yt-dlp')).toEqual({ ok: true, value: null });
  expect(execute).not.toHaveBeenCalled(); expect(repository.getHelperSelection('yt-dlp')).toBe(selected);
  for (const status of ['timeout', 'unavailable', 'failed'] as const) {
    execute.mockResolvedValueOnce({ status, stdout: 'secret stdout', stderr: 'secret stderr' });
    expect(await service.getStatus('yt-dlp')).toEqual({ ok: true, value: { kind: 'yt-dlp', mode: 'configured', path: selected, requiredVersion: '2026.08.19', state: 'unavailable', version: undefined } });
  }
});

it('selected paths and clearing survive restart independently per helper/profile', async () => {
  await helper().choose('yt-dlp'); await helper({}, vi.fn(async () => path.join(directory, 'custom-post.exe'))).choose('post-archiver');
  reopen();
  expect(repository.getHelperSelection('yt-dlp')).toBe(path.join(directory, 'custom.exe'));
  expect(repository.getHelperSelection('post-archiver')).toBe(path.join(directory, 'custom-post.exe'));
  const other = ReaderRepository.open(path.join(directory, 'other-profile.sqlite'));
  try { expect(other.getHelperSelection('yt-dlp')).toBeUndefined(); } finally { other.close(); }
  await helper().clear('yt-dlp'); reopen();
  expect(repository.getHelperSelection('yt-dlp')).toBeUndefined();
  expect(repository.getHelperSelection('post-archiver')).toBe(path.join(directory, 'custom-post.exe'));
});

it('schema-6 migration preserves all content, state, history, workspace and durable undo, with transactional retry', () => {
  repository.initializeDemo(); repository.updatePreferences({ locale: 'pl' }, ['en']);
  repository.changeWorkspace('openSettings'); repository.bulkSeen({ itemId: 'video-demo', seen: true, target: { kind: 'all' } });
  const before = repository.bootstrap(['en']), history = repository.history();
  const db = new DatabaseSync(file);
  try {
    db.exec('DROP TABLE helper_settings; PRAGMA user_version=6;');
    const tables = ['content_items', 'comments', 'comment_state', 'extraction_attempts', 'workspace', 'workspace_tabs', 'preferences', 'seen_operations', 'seen_operation_entries'];
    const rows = () => tables.map(table => db.prepare(`SELECT * FROM ${table}`).all());
    const original = rows();
    expect(() => migrateDatabase(db, [...migrations.slice(0, 6), { version: 7, apply: database => { migrations[6].apply(database); throw new Error('injected failure'); } }])).toThrow('injected failure');
    expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(6); expect(rows()).toEqual(original);
    migrateDatabase(db); expect(rows()).toEqual(original); expect(db.prepare('SELECT * FROM helper_settings').all()).toEqual([]);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
  reopen(); expect(repository.bootstrap(['en'])).toEqual(before); expect(repository.history()).toEqual(history);
  expect(repository.undoSeen('video-demo').restored).toBeGreaterThan(0);
});

it('ReaderService uses the newly selected/reset executable for later acquisition/Refresh without restart', async () => {
  const payload = JSON.parse(await readFile(path.join(__dirname, 'extractors/__fixtures__/yt-nested-a.json'), 'utf8')).raw;
  execute.mockImplementation(async request => output(request.arguments.includes('--version') ? '2026.08.19' : JSON.stringify(payload)));
  const selected = path.join(directory, 'custom.exe'), choose = vi.fn(async () => selected);
  const service = new ReaderService(() => repository, ['en'], vi.fn(), undefined, { environment: { PATH: directory }, platform: 'win32', execute, choose });
  const acquire = () => service.dispatch('acquire', [{ url: 'https://www.youtube.com/watch?v=VidDemo_001' }]);
  const first = await acquire(); if (!first.ok) throw new Error('Expected acquisition');
  expect(execute.mock.calls.at(-1)?.[0].executable).toBe(path.join(directory, 'yt-dlp.exe'));
  expect((await service.dispatch('chooseHelper', [{ kind: 'yt-dlp' }])).ok).toBe(true);
  await service.dispatch('refresh', [{ itemId: first.value.summary.itemId }]);
  expect(execute.mock.calls.at(-1)?.[0].executable).toBe(selected);
  choose.mockResolvedValueOnce(path.join(directory, 'missing.exe'));
  expect((await service.dispatch('chooseHelper', [{ kind: 'yt-dlp' }])).ok).toBe(false);
  await acquire(); expect(execute.mock.calls.at(-1)?.[0].executable).toBe(selected);
  await service.dispatch('clearHelper', [{ kind: 'yt-dlp' }]); await acquire();
  expect(execute.mock.calls.at(-1)?.[0].executable).toBe(path.join(directory, 'yt-dlp.exe'));
});

it.each(['getHelperStatus', 'chooseHelper', 'clearHelper'] as const)('%s validates exact kind and arity before any privileged work', async operation => {
  const choose = vi.fn(), diagnose = vi.fn(), service = new ReaderService(() => repository, ['en'], diagnose, undefined, { choose, execute, environment: {} });
  for (const payload of [null, [], {}, { kind: 'other' }, { kind: 'YT-DLP' }, { kind: 'yt-dlp', path: 'evil.exe' }, { kind: 'yt-dlp', arguments: ['--exec', 'evil'] }, { kind: 'yt-dlp', shell: true }]) {
    expect(await service.dispatch(operation, [payload])).toEqual({ ok: false, error: { code: 'INVALID_REQUEST' } });
  }
  for (const args of [[], [{ kind: 'yt-dlp' }, 'extra']]) expect(await service.dispatch(operation, args)).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  expect(choose).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
});
