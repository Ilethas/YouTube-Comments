import type { HelperKind } from '../shared/helper-settings';
import { testedHelperVersions } from '../shared/helper-settings';
import type { ExecuteProcess } from './helper-process';

/** Shared bounded helper-specific identity probe. Tested is confidence, not permission.
 * yt-dlp's version is a real calendar date; Community reports its named semantic version. */
export async function probeHelper(kind: HelperKind, executable: string, execute: ExecuteProcess,
  signal: AbortSignal, timeoutMs = 10000) {
  const community = kind === 'post-archiver';
  const outcome = await execute({ executable,
    arguments: community ? ['--version'] : ['--ignore-config', '--no-plugin-dirs', '--version'],
    environmentAdditions: community ? { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } : {},
    timeoutMs, maxStdoutBytes: 4096, signal });
  const successful = outcome.status === 'exited' && outcome.exitCode === 0;
  let version = successful ? (community ? /^post-archiver (\d{1,6}\.\d{1,6}\.\d{1,6})$/ : /^(\d{4}\.\d{2}\.\d{2})$/).exec(outcome.stdout.trim())?.[1] : undefined;
  if (version && !community) {
    const [year, month, day] = version.split('.').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) version = undefined;
  }
  return { outcome, version, tested: version !== undefined && version === testedHelperVersions[kind] };
}
