import { setImmediate } from 'node:timers/promises';
import type { AcquisitionStage, CommentProgress } from '../shared/acquisition';
import { mkdtemp, mkdir, writeFile, readdir, readFile, lstat, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { NormalizedExtraction } from '../domain/extraction-observation';
import type { ErrorCode } from '../shared/reader-api';
import type { AcquisitionTarget } from './acquisition-target';
import { buildCommunityCommand, buildYtDlpCommand } from './extractors/invocation';
import { normalizeYtDlp } from './extractors/yt-dlp';
import { normalizeCommunityArchive } from './extractors/community';
import { executeProcess, createHelperResolver } from './helper-process';
import type { ExecuteProcess, ResolveHelper, ProcessOutcome } from './helper-process';
import { probeHelper } from './helper-probe';
import { YtDlpProgressParser } from './extractors/yt-dlp-progress';
import { watchVideoTitle } from './early-video-title';

export type LiveExtraction = { readonly extraction: NormalizedExtraction; readonly error?: ErrorCode };
export type ExtractLive = (target: AcquisitionTarget, signal: AbortSignal, stage?: (stage: AcquisitionStage) => void,
  comments?: (progress: CommentProgress) => void, title?: (title: string) => void) => Promise<LiveExtraction>;
const maxOutput = 128 * 1024 * 1024;

/** Main-only execution orchestration. Every diagnostic is an application-owned token;
 * raw output, paths and arbitrary stderr never enter attempt history or IPC. */
export function createLiveExtractor(options: { readonly execute?: ExecuteProcess; readonly resolve?: ResolveHelper;
  readonly temporaryRoot?: string } = {}): ExtractLive {
  const execute = options.execute ?? executeProcess, resolve = options.resolve ?? createHelperResolver();
  return async (target, signal, stage = () => undefined, comments = () => undefined, title = () => undefined) => {
    const community = target.sourceKind === 'youtube-community-post';
    const name = community ? 'post-archiver' : 'yt-dlp';
    const backend = community ? 'post-archiver-improved' : 'yt-dlp';
    let version = 'unverified';
    const evidence: string[] = [];
    const failure = (error: ErrorCode, reason: string): LiveExtraction => ({ error, extraction: {
      provenance: { backend, version, evidence }, issues: [], coverage: { kind: 'failed', reason },
    } });
    let workspace: string | undefined;
    let stopTitle: (() => Promise<void>) | undefined;
    const processFailure = (outcome: ProcessOutcome) => {
      if (outcome.status === 'exited' && outcome.exitCode === 0) return undefined;
      if (outcome.exitCode !== undefined) evidence.push(`exit-code:${outcome.exitCode}`);
      return failure(outcome.status === 'unavailable' ? 'HELPER_UNAVAILABLE' : 'ACQUISITION_FAILED', `process-${outcome.status}`);
    };
    let result: LiveExtraction | undefined;
    const attempt = async (): Promise<LiveExtraction> => {
      try {
        if (signal.aborted) return failure('ACQUISITION_FAILED', 'execution-aborted');
        const executable = await resolve(name);
        if (signal.aborted) return failure('ACQUISITION_FAILED', 'execution-aborted');
        if (!executable) return failure('HELPER_UNAVAILABLE', 'helper-not-found');
        const probe = await probeHelper(name, executable, execute, signal);
        if (probe.outcome.status !== 'exited' || probe.outcome.exitCode !== 0) return failure('HELPER_UNAVAILABLE', `probe-${probe.outcome.status}`);
        version = probe.version ?? 'unverified';
        if (!probe.version) return failure('HELPER_UNAVAILABLE', 'invalid-helper-identity');
        evidence.push('executable-version-verified');
        if (!probe.tested) evidence.push('untested-helper-version');
        if (signal.aborted) return failure('ACQUISITION_FAILED', 'execution-aborted');
        stage('preparing');
        let spec;
        let outputDirectory: string | undefined;
        if (community) {
          workspace = await mkdtemp(path.join(options.temporaryRoot ?? os.tmpdir(), 'youtube-comments-acquisition-'));
          outputDirectory = path.join(workspace, 'output');
          await mkdir(outputDirectory);
          const configFile = path.join(workspace, 'anonymous.json');
          // Verified 0.4.0 loader uses defaults for omitted fields; explicit config
          // prevents ambient config search, cookies and local image downloads.
          await writeFile(configFile, JSON.stringify({ scraping: { cookies_file: null, download_images: false } }), 'utf8');
          spec = buildCommunityCommand({ postUrl: target.url, outputDirectory, configFile, maxComments: 1000, maxReplies: 1000, timeoutSeconds: 15, retries: 2 });
          evidence.push('application-comment-limit:1000', 'application-reply-limit:1000');
        } else {
          let titleFile: string | undefined;
          try {
            workspace = await mkdtemp(path.join(options.temporaryRoot ?? os.tmpdir(), 'youtube-comments-acquisition-'));
            const candidate = path.join(workspace, 'title.json');
            await writeFile(candidate, '', { encoding: 'utf8', flag: 'wx' });
            titleFile = candidate;
            stopTitle = watchVideoTitle(titleFile, signal, title);
          } catch { /* Optional title discovery never blocks acquisition. */ }
          spec = buildYtDlpCommand({ videoUrl: target.url, timeoutSeconds: 15, retries: 2, titleFile });
        }
        if (signal.aborted) return failure('ACQUISITION_FAILED', 'execution-aborted');
        stage('fetching');
        const progress = new YtDlpProgressParser(value => { if (!signal.aborted) comments(value); });
        const outcome = await execute({ executable, arguments: spec.arguments, environmentAdditions: spec.environmentAdditions,
          cwd: workspace, maxStdoutBytes: maxOutput, signal,
          ...(!community ? { onStderr: (chunk: Buffer) => progress.push(chunk) } : {}) });
        await stopTitle?.(); stopTitle = undefined;
        if (!community) progress.end();
        const executionFailure = processFailure(outcome);
        if (executionFailure) return executionFailure;
        evidence.push('process-exit-zero');
        stage('processing');
        await setImmediate();
        if (signal.aborted) return failure('ACQUISITION_FAILED', 'execution-aborted');
        let raw = outcome.stdout;
        if (outputDirectory) {
          // 0.4.0 overwrites metadata.channel_id with author.id or "unknown" before
          // saving, so individual-post files actually use posts_<channel>_<time>.json.
          const entries = await readdir(outputDirectory);
          const archives = entries.filter(file => /^posts_(?:UC[A-Za-z0-9_-]{22}|unknown)_\d{8}_\d{6}\.json$/.test(file));
          if (archives.length !== 1 || entries.filter(file => file.endsWith('.json')).length !== 1) return failure('ACQUISITION_FAILED', 'archive-missing-or-ambiguous');
          const file = path.join(outputDirectory, archives[0]);
          const info = await lstat(file);
          if (!info.isFile() || info.size > maxOutput) return failure('ACQUISITION_FAILED', 'archive-invalid-or-too-large');
          raw = await readFile(file, 'utf8');
        }
        if (signal.aborted) return failure('ACQUISITION_FAILED', 'execution-aborted');
        const context = { provenance: { backend, version, evidence },
          ...(community ? { partialEvidence: ['application-comment-and-reply-limits'] }
            : progress.hasWarning || /WARNING:/i.test(outcome.stderr) ? { partialEvidence: ['helper-reported-warning'] } : {}) };
        const extraction = community ? normalizeCommunityArchive(raw, context) : normalizeYtDlp(raw, context);
        if (signal.aborted) return failure('ACQUISITION_FAILED', 'execution-aborted');
        if (!extraction.item) return { extraction, error: 'ACQUISITION_FAILED' };
        if (extraction.item.sourceId !== target.sourceId || extraction.item.sourceKind !== target.sourceKind) return failure('ACQUISITION_FAILED', 'output-target-mismatch');
        return { extraction };
      } catch { return failure('ACQUISITION_FAILED', 'execution-or-workspace-failure'); }
    };
    try { result = await attempt(); }
    finally {
      await stopTitle?.();
      if (workspace) {
        try { await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
        catch { result = failure('ACQUISITION_FAILED', 'workspace-cleanup-failed'); }
      }
    }
    return result ?? failure('ACQUISITION_FAILED', 'execution-failure');
  };
}
