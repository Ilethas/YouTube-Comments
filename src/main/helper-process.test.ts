import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createProcessExecutor, createHelperResolver, resolvePathHelper } from './helper-process';

function child() { return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess; }
const request = { executable: '/trusted/yt-dlp', arguments: ['--', 'https://www.youtube.com/watch?v=abcdefghijk'], environmentAdditions: { PYTHONUTF8: '1' }, timeoutMs: 1000, maxStdoutBytes: 100 };
it.skipIf(process.platform !== 'win32')('real Windows cancellation terminates a ready parent and its descendant before settling', async () => {
  const controller = new AbortController();
  let ready!: (pid: number) => void;
  const descendant = new Promise<number>(resolve => { ready = resolve; });
  const source = "const {spawn}=require('node:child_process'); const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true,shell:false}); child.on('spawn',()=>console.log(child.pid)); setInterval(()=>{},1000);";
  const execute = createProcessExecutor((file, args, options) => {
    const child = spawn(file, args, options);
    child.stdout?.once('data', data => ready(Number(String(data).trim())));
    return child;
  });
  const pending = execute({ executable: process.execPath, arguments: ['-e', source], environmentAdditions: {},
    maxStdoutBytes: 1024, signal: controller.signal });
  const pid = await descendant;
  expect(Number.isSafeInteger(pid)).toBe(true);
  controller.abort();
  expect((await pending).status).toBe('aborted');
  expect(() => process.kill(pid, 0)).toThrow();
}, 15000);
it('spawns exact executable and array with no shell, private environment and separate streams', async () => {
  const process = child(), launch = vi.fn(() => process);
  const previous = globalThis.process.env.PYTHONUTF8;
  const pending = createProcessExecutor(launch)(request);
  process.stdout?.emit('data', Buffer.from('data'));
  process.stderr?.emit('data', Buffer.from('diagnostic'));
  process.emit('close', 0);
  expect(await pending).toEqual({ status: 'exited', exitCode: 0, stdout: 'data', stderr: 'diagnostic' });
  expect(launch.mock.calls[0]).toEqual([request.executable, request.arguments, expect.objectContaining({ shell: false, windowsHide: true, env: expect.objectContaining({ PYTHONUTF8: '1' }), stdio: ['ignore', 'pipe', 'pipe'] })]);
  expect(globalThis.process.env.PYTHONUTF8).toBe(previous);
});
it('deadline kills, waits for close, then returns failed timeout', async () => {
  vi.useFakeTimers();
  try {
    const process = child(), kill = vi.fn();
    const pending = createProcessExecutor(() => process, kill)(request);
    await vi.advanceTimersByTimeAsync(1000);
    expect(kill).toHaveBeenCalledWith(process);
    process.emit('close', null);
    expect((await pending).status).toBe('timeout');
  } finally { vi.useRealTimers(); }
});
it('an unbounded extraction remains alive past 180 seconds and cancellation still awaits close', async () => {
  vi.useFakeTimers();
  try {
    const process = child(), kill = vi.fn(), controller = new AbortController();
    const pending = createProcessExecutor(() => process, kill)({ ...request, timeoutMs: undefined, signal: controller.signal });
    let settled = false; void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(600000);
    expect(kill).not.toHaveBeenCalled(); expect(settled).toBe(false);
    controller.abort();
    expect(kill).toHaveBeenCalledTimes(1); expect(settled).toBe(false);
    process.emit('close', null);
    expect((await pending).status).toBe('aborted');
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});
it('streams stderr beyond the retained diagnostic limit while preserving JSON stdout', async () => {
  const process = child(), chunks: Buffer[] = [];
  const pending = createProcessExecutor(() => process)({ ...request, onStderr: chunk => chunks.push(chunk) });
  process.stderr?.emit('data', Buffer.alloc(65536, 65));
  process.stderr?.emit('data', Buffer.from('late progress\n'));
  process.stdout?.emit('data', Buffer.from('{"comments":[]}'));
  process.emit('close', 0);
  const result = await pending;
  expect(chunks).toHaveLength(2); expect(chunks[1].toString()).toBe('late progress\n');
  expect(result.stderr).toHaveLength(65536); expect(JSON.parse(result.stdout)).toEqual({ comments: [] });
});
it('classifies ENOENT without sending its raw message', async () => {
  const process = child();
  const pending = createProcessExecutor(() => process)(request);
  process.emit('error', Object.assign(new Error('private path'), { code: 'ENOENT' }));
  process.emit('close', -2);
  expect(await pending).toEqual({ status: 'unavailable', exitCode: -2, stdout: '', stderr: '' });
});
it('bounds output and diagnostic buffers, and supports lifecycle abort', async () => {
  for (const abort of [false, true]) {
    const process = child(), kill = vi.fn(), controller = new AbortController();
    const pending = createProcessExecutor(() => process, kill)({ ...request, signal: controller.signal });
    process.stderr?.emit('data', Buffer.alloc(100000, 65));
    if (abort) controller.abort();
    else process.stdout?.emit('data', Buffer.alloc(101));
    process.emit('close', null);
    const result = await pending;
    expect(result.status).toBe(abort ? 'aborted' : 'output-limit');
    expect(result.stderr.length).toBe(65536);
    expect(kill).toHaveBeenCalledTimes(1);
  }
});
it('PATH resolver selects only a direct Windows exe and skips batch and relative entries', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reader-resolver-test-'));
  try {
    await writeFile(path.join(directory, 'yt-dlp.bat'), 'ignored');
    expect(await resolvePathHelper('yt-dlp', { PATH: `.;relative;${directory}` }, 'win32')).toBeUndefined();
    await writeFile(path.join(directory, 'yt-dlp.exe'), 'fake');
    expect(await resolvePathHelper('yt-dlp', { PATH: `.;${directory}` }, 'win32')).toBe(path.join(directory, 'yt-dlp.exe'));
    expect(await resolvePathHelper('post-archiver', { PATH: directory }, 'win32')).toBeUndefined();
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('explicit absolute executable wins over PATH, snapshots startup config, and rejects invalid overrides without fallback', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'reader-override-test-'));
  try {
    const selected = path.join(directory, 'explicit.exe');
    await writeFile(selected, 'test-only fake');
    await writeFile(path.join(directory, 'yt-dlp.exe'), 'test-only fake PATH');
    const environment = { PATH: directory, YOUTUBE_COMMENTS_YTDLP_EXE: selected };
    const resolve = createHelperResolver(environment, 'win32');
    environment.YOUTUBE_COMMENTS_YTDLP_EXE = 'relative.exe';
    expect(await resolve('yt-dlp')).toBe(selected);
    expect(await createHelperResolver({ PATH: directory }, 'win32')('yt-dlp')).toBe(path.join(directory, 'yt-dlp.exe'));
    for (const invalid of ['', 'relative.exe', '\\root-relative.exe', 'C:drive-relative.exe', path.join(directory, 'missing.exe'), directory, path.join(directory, 'wrapper.bat'), path.join(directory, 'wrapper.cmd')]) {
      if (/\.(bat|cmd)$/.test(invalid)) await writeFile(invalid, 'ignored');
      expect(await createHelperResolver({ PATH: directory, YOUTUBE_COMMENTS_YTDLP_EXE: invalid }, 'win32')('yt-dlp')).toBeUndefined();
    }
    expect(await createHelperResolver({ YOUTUBE_COMMENTS_POST_ARCHIVER_EXE: selected }, 'win32')('post-archiver')).toBe(selected);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
