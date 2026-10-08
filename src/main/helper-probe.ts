import type { HelperKind } from '../shared/helper-settings';
import { requiredHelperVersions } from '../shared/helper-settings';
import type { ExecuteProcess } from './helper-process';

/** Shared bounded exact probe for Settings acceptance/status and every acquisition. */
export async function probeHelper(kind: HelperKind, executable: string, execute: ExecuteProcess,
  signal: AbortSignal, timeoutMs = 10000) {
  const community = kind === 'post-archiver';
  const outcome = await execute({ executable,
    arguments: community ? ['--version'] : ['--ignore-config', '--no-plugin-dirs', '--version'],
    environmentAdditions: community ? { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } : {},
    timeoutMs, maxStdoutBytes: 4096, signal });
  const successful = outcome.status === 'exited' && outcome.exitCode === 0;
  const version = successful ? (community ? /^post-archiver (\d+\.\d+\.\d+)$/ : /^(\d{4}\.\d{2}\.\d{2})$/).exec(outcome.stdout.trim())?.[1] : undefined;
  return { outcome, version, compatible: successful && version === requiredHelperVersions[kind] };
}
