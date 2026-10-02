import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { createProcessExecutor, resolvePathHelper } from './helper-process';

function child() { return Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() }) as unknown as ChildProcess; }
const request = { executable: '/trusted/yt-dlp', arguments: ['--', 'https://www.youtube.com/watch?v=abcdefghijk'], environmentAdditions: { PYTHONUTF8: '1' }, timeoutMs: 1000, maxStdoutBytes: 100 };
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
