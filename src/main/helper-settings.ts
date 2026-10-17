import type { HelperKind, HelperStatus } from '../shared/helper-settings';
import { testedHelperVersions } from '../shared/helper-settings';
import type { Result } from '../shared/reader-api';
import { createHelperResolution, executeProcess, helperOverrideVariables, isHelperExecutable } from './helper-process';
import type { ExecuteProcess, ResolveHelper } from './helper-process';
import { probeHelper } from './helper-probe';
import type { ReaderCallerContext } from './caller-context';

export interface HelperSelectionStore {
  getHelperSelection(kind: HelperKind): string | undefined;
  setHelperSelection(kind: HelperKind, executable?: string): void;
}
/** Main-only injection; renderer can request a helper identity, never a file path. */
export interface HelperSettingsOptions {
  readonly choose?: (kind: HelperKind, caller?: ReaderCallerContext) => Promise<string | undefined>;
  readonly execute?: ExecuteProcess;
  readonly environment?: NodeJS.ProcessEnv;
  readonly platform?: NodeJS.Platform;
}

/** Serialized main-owned selection/check lifecycle. Status is explicitly requested
 * by Settings, never probed during bootstrap or ordinary Reader renders. */
export class HelperSettingsService {
  private readonly startup: NodeJS.ProcessEnv;
  private readonly platform: NodeJS.Platform;
  private readonly execute: ExecuteProcess;
  private readonly resolution;
  private readonly controller = new AbortController();
  private queue = Promise.resolve();
  readonly resolve: ResolveHelper;

  constructor(private readonly store: HelperSelectionStore, private readonly options: HelperSettingsOptions = {}) {
    this.startup = { ...(options.environment ?? process.env) };
    this.platform = options.platform ?? process.platform;
    this.execute = options.execute ?? executeProcess;
    this.resolution = createHelperResolution(this.startup, this.platform, kind => store.getHelperSelection(kind));
    this.resolve = async kind => (await this.resolution(kind)).executable;
  }

  private serial<T>(action: () => Promise<T>): Promise<T> {
    const pending = this.queue.then(action);
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async inspect(kind: HelperKind, mode: HelperStatus['mode'], file?: string, executable?: string): Promise<HelperStatus> {
    const base = { kind, mode, path: file, testedVersion: testedHelperVersions[kind] };
    if (!executable) return { ...base, state: mode === 'configured' || mode === 'environment' ? 'invalid-path' : 'unavailable' };
    try {
      const probe = await probeHelper(kind, executable, this.execute, this.controller.signal);
      return { ...base, version: probe.version, state: probe.version ? probe.tested ? 'tested' : 'untested' : 'unavailable' };
    } catch { return { ...base, state: 'unavailable' }; }
  }

  getStatus(kind: HelperKind): Promise<Result<HelperStatus>> {
    return this.serial(async () => {
      const selected = await this.resolution(kind);
      return { ok: true, value: await this.inspect(kind, selected.mode, selected.path, selected.executable) };
    });
  }

  choose(kind: HelperKind, caller?: ReaderCallerContext): Promise<Result<HelperStatus | null>> {
    return this.serial(async () => {
      if (caller && !caller.isCurrent()) return { ok: true, value: null };
      if (this.startup[helperOverrideVariables[kind]] !== undefined) return { ok: false, error: { code: 'FORBIDDEN' } };
      if (this.controller.signal.aborted || !this.options.choose) return { ok: false, error: { code: 'HELPER_UNAVAILABLE' } };
      const file = await this.options.choose(kind, caller);
      if (file === undefined || caller && !caller.isCurrent()) return { ok: true, value: null };
      const executable = await isHelperExecutable(file, this.platform) ? file : undefined;
      const status = await this.inspect(kind, 'configured', file, executable);
      if (caller && !caller.isCurrent()) return { ok: true, value: null };
      if (!['tested', 'untested'].includes(status.state) || this.controller.signal.aborted) return { ok: false,
        error: { code: 'HELPER_UNAVAILABLE' } };
      this.store.setHelperSelection(kind, file);
      return { ok: true, value: status };
    });
  }

  clear(kind: HelperKind): Promise<Result<HelperStatus>> {
    return this.serial(async () => {
      if (this.startup[helperOverrideVariables[kind]] !== undefined) return { ok: false, error: { code: 'FORBIDDEN' } };
      if (this.controller.signal.aborted) return { ok: false, error: { code: 'HELPER_UNAVAILABLE' } };
      this.store.setHelperSelection(kind);
      const selected = await this.resolution(kind);
      return { ok: true, value: await this.inspect(kind, selected.mode, selected.path, selected.executable) };
    });
  }

  async shutdown(): Promise<void> { this.controller.abort(); await this.queue; }
  /** Drain selections already accepted before a snapshot mutation barrier. */
  settle(): Promise<void> { return this.queue; }
}
