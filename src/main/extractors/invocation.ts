/** Pure specifications only. Executable resolution, configuration-file creation and process
 * execution belong to a later main-side service. Environment additions apply to a child only. */
export interface HelperCommandSpec {
  readonly backend: 'yt-dlp' | 'post-archiver-improved';
  readonly executable: 'yt-dlp' | 'post-archiver';
  readonly arguments: readonly string[];
  readonly environmentAdditions: Readonly<Record<string, string>>;
  readonly output: 'single-json-stdout' | 'archive-json-directory';
}

interface NetworkBounds { readonly timeoutSeconds: number; readonly retries: number }

function integer(value: number, minimum: number, maximum: number): string {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error('Invalid invocation bound');
  return String(value);
}

function target(url: string, kind: 'video' | 'post'): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['www.youtube.com', 'youtube.com'].includes(parsed.hostname) || parsed.username || parsed.password || parsed.port) throw new Error('Unsupported target URL');
  const videoId = parsed.searchParams.get('v');
  if (kind === 'video' && parsed.pathname === '/watch' && videoId) return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
  if (kind === 'post' && /^\/post\/[^/]+\/?$/.test(parsed.pathname)) return `https://www.youtube.com${parsed.pathname.replace(/\/$/, '')}`;
  throw new Error('Expected individual content URL');
}

/** The investigated JSON-only/no-media intent, with explicit bounded network inputs.
 * A configured comment limit is an invocation fact, not serialized completeness evidence. */
export function buildYtDlpCommand(input: NetworkBounds & { readonly videoUrl: string; readonly maxComments?: number }): HelperCommandSpec {
  const args = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--skip-download', '--dump-single-json', '--write-comments',
    '--socket-timeout', integer(input.timeoutSeconds, 1, Number.MAX_SAFE_INTEGER), '--retries', integer(input.retries, 0, Number.MAX_SAFE_INTEGER), '--extractor-retries', integer(input.retries, 0, Number.MAX_SAFE_INTEGER)];
  if (input.maxComments !== undefined) args.push('--extractor-args', `youtube:max_comments=${integer(input.maxComments, 1, Number.MAX_SAFE_INTEGER)}`);
  args.push('--', target(input.videoUrl, 'video'));
  return { backend: 'yt-dlp', executable: 'yt-dlp', arguments: args, environmentAdditions: {}, output: 'single-json-stdout' };
}

/** Requires caller-owned output/config locations and explicit helper limits. Does not use
 * the broken 0.4.0 --quiet switch, cookies, image downloads or ambient configuration. */
export function buildCommunityCommand(input: NetworkBounds & { readonly postUrl: string; readonly outputDirectory: string; readonly configFile: string; readonly maxComments: number; readonly maxReplies: number }): HelperCommandSpec {
  if (!input.outputDirectory.trim() || !input.configFile.trim()) throw new Error('Explicit output/config paths required');
  return {
    backend: 'post-archiver-improved', executable: 'post-archiver', output: 'archive-json-directory',
    environmentAdditions: { PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    arguments: ['--comments', '--output', input.outputDirectory, '--config', input.configFile,
      '--max-comments', integer(input.maxComments, 1, Number.MAX_SAFE_INTEGER), '--max-replies', integer(input.maxReplies, 1, Number.MAX_SAFE_INTEGER),
      '--timeout', integer(input.timeoutSeconds, 1, Number.MAX_SAFE_INTEGER), '--retries', integer(input.retries, 0, Number.MAX_SAFE_INTEGER), '--', target(input.postUrl, 'post')],
  };
}
