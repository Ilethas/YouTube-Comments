import { spawn } from 'node:child_process';
import type { ChildProcess, SpawnOptions } from 'node:child_process';
import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export type HelperName = 'yt-dlp' | 'post-archiver';
export interface ProcessRequest {
  readonly executable: string;
  readonly arguments: readonly string[];
  readonly environmentAdditions: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly timeoutMs: number;
  readonly maxStdoutBytes: number;
  readonly signal?: AbortSignal;
}
export interface ProcessOutcome {
  readonly status: 'exited' | 'unavailable' | 'failed' | 'timeout' | 'output-limit' | 'aborted';
  readonly exitCode?: number;
  readonly stdout: string;
  readonly stderr: string;
}
export type ExecuteProcess = (request: ProcessRequest) => Promise<ProcessOutcome>;
export type ResolveHelper = (name: HelperName) => Promise<string | undefined>;

export const helperOverrideVariables = {
  'yt-dlp': 'YOUTUBE_COMMENTS_YTDLP_EXE',
  'post-archiver': 'YOUTUBE_COMMENTS_POST_ARCHIVER_EXE',
} as const;

/** Main startup configuration wins over PATH. A configured invalid path fails closed
 * as unavailable, including empty/relative/directory/batch paths; never fallback.
 * Selection is not trust: live extraction must still probe the selected binary. */
export function createHelperResolver(environment: NodeJS.ProcessEnv = process.env, platform = process.platform): ResolveHelper {
  const startup = { ...environment };
  return async name => {
    const override = startup[helperOverrideVariables[name]];
    if (override === undefined) return resolvePathHelper(name, startup, platform);
    const root = path.parse(override).root;
    if (!path.isAbsolute(override) || (platform === 'win32' && (path.extname(override).toLowerCase() !== '.exe'
      || (process.platform === 'win32' && (root === '\\' || root === '/'))))) return undefined;
    try {
      await access(override, platform === 'win32' ? constants.F_OK : constants.X_OK);
      return (await stat(override)).isFile() ? override : undefined;
    } catch { return undefined; }
  };
}

/** Development PATH lookup only. Windows requires .exe: batch wrappers need a shell.
 * Skip empty/relative PATH entries, so the application working directory is not a helper source. */
export async function resolvePathHelper(name: HelperName, environment = process.env, platform = process.platform): Promise<string | undefined> {
  const separator = platform === 'win32' ? ';' : ':';
  const entries = (environment.PATH ?? environment.Path ?? '').split(separator);
  for (const entry of entries) {
    const directory = entry.replace(/^"|"$/g, '');
    if (!path.isAbsolute(directory)) continue;
    const file = path.join(directory, platform === 'win32' ? `${name}.exe` : name);
    try {
      await access(file, platform === 'win32' ? constants.F_OK : constants.X_OK);
      if ((await stat(file)).isFile()) return file;
    } catch { /* Try the next PATH directory. */ }
  }
  return undefined;
}

/** Kill the Python console launcher's descendants too on Windows. No shell is involved. */
function terminate(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
      ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
    killer.on('error', () => child.kill('SIGKILL'));
    killer.on('exit', code => { if (code !== 0) child.kill('SIGKILL'); });
  } else child.kill('SIGKILL');
}

/** Async structured execution, bounded buffers and separate diagnostics. Resolves only
 * after close, so callers can remove workspaces without a still-writing child. */
export function createProcessExecutor(launch: (file: string, args: string[], options: SpawnOptions) => ChildProcess = spawn,
  kill: (child: ChildProcess) => void = terminate): ExecuteProcess {
  return request => new Promise(resolve => {
    let status: ProcessOutcome['status'] = 'exited';
    const stdout: Buffer[] = [], stderr: Buffer[] = [];
    let outBytes = 0, errBytes = 0;
    const finish = (exitCode?: number) => resolve({ status, exitCode, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    if (request.signal?.aborted) { status = 'aborted'; finish(); return; }
    let child: ChildProcess;
    try {
      child = launch(request.executable, [...request.arguments], { shell: false, windowsHide: true,
        cwd: request.cwd, env: { ...process.env, ...request.environmentAdditions }, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch { status = 'failed'; finish(); return; }
    const stop = (reason: ProcessOutcome['status']) => { if (status === 'exited') { status = reason; kill(child); } };
    const timer = setTimeout(() => stop('timeout'), Math.max(1, request.timeoutMs));
    const abort = () => stop('aborted');
    request.signal?.addEventListener('abort', abort, { once: true });
    child.stdout?.on('data', (data: Buffer) => {
      outBytes += data.length;
      if (outBytes > request.maxStdoutBytes) stop('output-limit');
      else stdout.push(data);
    });
    child.stderr?.on('data', (data: Buffer) => {
      if (errBytes < 65536) stderr.push(data.subarray(0, 65536 - errBytes));
      errBytes += data.length;
    });
    child.on('error', (error: NodeJS.ErrnoException) => { status = error.code === 'ENOENT' ? 'unavailable' : 'failed'; });
    child.on('close', code => {
      clearTimeout(timer);
      request.signal?.removeEventListener('abort', abort);
      finish(code ?? undefined);
    });
  });
}
export const executeProcess = createProcessExecutor();
