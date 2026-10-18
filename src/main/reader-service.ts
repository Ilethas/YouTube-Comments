import type { SharedCommit, SharedSnapshot, SharedItemSnapshot, SharedMetadata } from '../shared/reader-sync';
import type { ReaderCallerContext } from './caller-context';
import { isCancelAcquisitionRequest } from '../shared/acquisition';
import type { AcquisitionNotification, AcquisitionProgress } from '../shared/acquisition';
import { isUndoSeenRequest, isPreferenceChange, isToggleSeenRequest, isAcquireRequest, isRefreshRequest, isTabRequest, isMoveTabRequest, isBulkSeenRequest, isHelperRequest, isCommentActionRequest } from '../shared/reader-api';
import type { AcquisitionResult, ReaderOperation, ReaderState, Result } from '../shared/reader-api';
import type { SeenMutationResult, SeenUndoResult } from '../domain/seen-operation';
import type { Preferences } from '../shared/preferences';
import { ReaderRepository, UndoConflictError, MissingCommentError, NotRemovableError, InvalidSeenTargetError, InvalidDiscussionViewError, InvalidPreferenceError } from './persistence/reader-repository';
import { isSetDiscussionCollapseRequest } from '../domain/discussion-collapse';
import { isSaveDiscussionViewRequest } from '../domain/discussion-view';
import { UnsupportedSchemaError } from './persistence/migrations';
import { AcquisitionService } from './acquisition-service';
import { createLiveExtractor } from './live-extraction';
import type { ExtractLive } from './live-extraction';
import { InvalidWorkspaceMoveError } from '../domain/workspace';
import type { WorkspaceState } from '../domain/workspace';
import type { HelperStatus } from '../shared/helper-settings';
import { HelperSettingsService } from './helper-settings';
import type { HelperSettingsOptions } from './helper-settings';
import { sourceUrl } from './source-url';
import { authorUrl, commentPermalink, commentActionAvailability, translationUrl } from './comment-actions';
import path from 'node:path';
import type { DataBackupResult } from '../shared/data-backup';
import type { DataBackupDialogs } from './data-backup-dialogs';
import { BackupValidationError } from './persistence/backup-validation';
import { validateBackupDestination } from './persistence/sqlite-backup';
import { installRestore, prepareRestore } from './persistence/profile-restore';
import type { RestoreCheckpoint } from './persistence/profile-restore';
import { randomUUID } from 'node:crypto';
import type { ThumbnailCache, CachedThumbnail } from './thumbnail-cache';
import type { ProfileOperationCoordinator } from './profile-operation-coordinator';
import type { DrainCommand } from '../shared/profile-operation';

export interface DataBackupOptions {
  readonly databasePath: string;
  readonly dialogs: DataBackupDialogs;
  readonly restart: () => void;
  readonly checkpoint?: RestoreCheckpoint;
}
type ServiceValue = SharedSnapshot | SharedItemSnapshot | SharedMetadata | ReaderState | SeenMutationResult | Preferences | WorkspaceState | AcquisitionProgress | AcquisitionResult | HelperStatus | DataBackupResult | string | null;

/** Small use-case boundary: validate before touching persistence; failures carry
 * stable codes. Diagnostics are reported only on the privileged side. */
export class ReaderService {
  private lifecycle?: ProfileOperationCoordinator;
  attachLifecycle(coordinator: ProfileOperationCoordinator): void { this.lifecycle = coordinator; }
  private lastProfileStamp?: import('../shared/reader-sync').SharedStamp;
  profileStamp() {
    if (this.repository) this.lastProfileStamp = this.repository.stamp();
    return this.lastProfileStamp ?? { profileEpoch: this.unavailableEpoch, commitRevision: 0 };
  }
  private readonly unavailableEpoch = randomUUID();
  /** Main-only sealed checkpoint entry. Ordinary dispatch never accepts a bypass. */
  drainCheckpoint(caller: ReaderCallerContext, command: DrainCommand): Result<unknown> {
    const operation = command.kind === 'view' ? 'saveDiscussionView' : command.kind === 'collapse' ? 'setDiscussionCollapse' : command.kind;
    const result = this.execute(operation, [command.request], caller, true) as Result<unknown>;
    return result.ok ? { ...result, sync: this.repository?.latestCommit() ?? this.profileStamp() } : result;
  }
  get restarting(): boolean { return this.restartPending; }
  profileCheckpointAllowed(command: DrainCommand): boolean {
    if ('ticket' in command) return true;
    try { return !!this.repository?.getStoredItem(command.request.itemId); } catch { return false; }
  }
  async settleDataOperation(): Promise<void> { await this.dataPending; }
  private readonly helperEvidence = new Map<string, string>();
  private readonly commitObservers = new Set<(commit: SharedCommit) => void>();
  onSharedCommit(listener: (commit: SharedCommit) => void): () => void { this.commitObservers.add(listener); return () => { this.commitObservers.delete(listener); }; }
  private repository?: ReaderRepository;
  private acquisition?: AcquisitionService;
  private helpers?: HelperSettingsService;
  private failure?: 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED_SCHEMA';
  private dataPending?: Promise<Result<DataBackupResult>>;
  private stopping = false;
  private restartPending = false;
  private thumbnailGrants = new Map<string, { itemId: string; value: CachedThumbnail }>();
  constructor(private readonly open: () => ReaderRepository, private readonly languages: readonly string[],
    private readonly diagnose: (error: unknown) => void = console.error,
    private readonly extract?: ExtractLive,
    private readonly helperOptions: HelperSettingsOptions = {},
    private readonly openBrowser?: (url: string) => Promise<void>,
    private readonly notifyProgress: (value: AcquisitionNotification) => void = () => undefined,
    private readonly dataOptions?: DataBackupOptions,
    private readonly copyText?: (text: string) => void | Promise<void>,
    private readonly thumbnails?: { cache: ThumbnailCache; openPath: (file: string) => Promise<string> }) {
    this.initializeStorage();
  }

  /** Reuse the same safe open/demo-initialization path on recoverable bootstrap
   * retries. A successful repository is retained; unsupported schemas stay closed. */
  private initializeStorage(): void {
    try {
      this.repository = this.open();
      this.repository.onCommit(commit => {
        for (const listener of this.commitObservers) { try { listener(commit); } catch { /* Lost recipients do not affect commits. */ } }
      });
      this.helpers = new HelperSettingsService(this.repository, this.helperOptions);
      this.acquisition = new AcquisitionService(this.repository, this.languages,
        this.extract ?? createLiveExtractor({ resolve: this.helpers.resolve, execute: this.helperOptions.execute }), this.notifyProgress);
      this.failure = undefined;
    }
    catch (error) {
      this.failure = error instanceof UnsupportedSchemaError ? 'UNSUPPORTED_SCHEMA' : 'STORAGE_UNAVAILABLE';
      this.diagnose(error);
    }
  }

  /** args preserve arity validation even for bootstrap's payload-free query.
   * IPC supplies main-authenticated context separately; trusted internal callers
   * may omit it. Shared operations stay profile-owned; only dialogs need origin. */
  dispatch(operation: 'bootstrap' | 'removeLibraryItem', args: readonly unknown[], caller?: ReaderCallerContext): Result<ReaderState>;
  dispatch(operation: 'toggleSeen' | 'bulkSeen', args: readonly unknown[], caller?: ReaderCallerContext): Result<SeenMutationResult>;
  dispatch(operation: 'undoSeen', args: readonly unknown[], caller?: ReaderCallerContext): Result<SeenUndoResult>;
  dispatch(operation: 'updatePreferences', args: readonly unknown[], caller?: ReaderCallerContext): Result<Preferences>;
  dispatch(operation: 'openStoredItem' | 'activateTab' | 'closeTab' | 'openLibrary' | 'openSettings' | 'moveTab', args: readonly unknown[], caller?: ReaderCallerContext): Result<WorkspaceState>;
  dispatch(operation: 'acquire' | 'refresh', args: readonly unknown[], caller?: ReaderCallerContext): Promise<Result<AcquisitionResult>>;
  dispatch(operation: 'getHelperStatus' | 'clearHelper', args: readonly unknown[], caller?: ReaderCallerContext): Promise<Result<HelperStatus>>;
  dispatch(operation: 'chooseHelper', args: readonly unknown[], caller?: ReaderCallerContext): Promise<Result<HelperStatus | null>>;
  dispatch(operation: 'openSource' | 'openCommentAction', args: readonly unknown[], caller?: ReaderCallerContext): Promise<Result<null>>;
  dispatch(operation: 'getSharedSnapshot', args: readonly unknown[], caller?: ReaderCallerContext): Result<SharedSnapshot | SharedItemSnapshot>;
  dispatch(operation: 'getSharedMetadata', args: readonly unknown[], caller?: ReaderCallerContext): Result<SharedMetadata>;
  dispatch(operation: 'getAcquisitionProgress', args: readonly unknown[], caller?: ReaderCallerContext): Result<AcquisitionProgress | null>;
  dispatch(operation: 'cancelAcquisition', args: readonly unknown[], caller?: ReaderCallerContext): Result<null>;
  dispatch(operation: 'saveDiscussionView' | 'setDiscussionCollapse', args: readonly unknown[], caller?: ReaderCallerContext): Result<null>;
  dispatch(operation: 'createBackup' | 'restoreBackup', args: readonly unknown[], caller?: ReaderCallerContext): Promise<Result<DataBackupResult>>;
  dispatch(operation: 'getThumbnail' | 'checkThumbnail', args: readonly unknown[], caller?: ReaderCallerContext): Promise<Result<string | null>>;
  dispatch(operation: 'openThumbnail', args: readonly unknown[], caller?: ReaderCallerContext): Promise<Result<null>>;
  dispatch(operation: ReaderOperation, args: readonly unknown[], caller?: ReaderCallerContext): Result<ServiceValue> | Promise<Result<ServiceValue>>;
  dispatch(operation: ReaderOperation, args: readonly unknown[], caller?: ReaderCallerContext): Result<ServiceValue> | Promise<Result<ServiceValue>> {
    const shared = ['bootstrap', 'toggleSeen', 'bulkSeen', 'undoSeen', 'updatePreferences', 'removeLibraryItem',
      'openStoredItem', 'activateTab', 'closeTab', 'openLibrary', 'openSettings', 'moveTab', 'acquire', 'refresh',
      'chooseHelper', 'clearHelper', 'saveDiscussionView', 'setDiscussionCollapse'].includes(operation);
    const attach = (result: Result<ServiceValue>): Result<ServiceValue> => {
      const stamp = shared && (result.ok || result.error.code === 'UNDO_CONFLICT') ? result.sync ?? this.repository?.latestCommit() ?? this.repository?.stamp() : undefined;
      return stamp ? { ...result, sync: stamp } : result;
    };
    const result = this.execute(operation, args, caller);
    return result instanceof Promise ? result.then(attach) : attach(result);
  }
  private execute(operation: ReaderOperation, args: readonly unknown[], caller?: ReaderCallerContext, checkpoint = false): Result<ServiceValue> | Promise<Result<ServiceValue>> {
    if (operation === 'createBackup' || operation === 'restoreBackup') {
      if (args.length !== 0) return Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
      if (this.dataPending || this.stopping || this.restartPending || this.lifecycle?.blocks(caller)) return Promise.resolve({ ok: false, error: { code: 'DATA_BUSY' } });
      this.dataPending = this.runDataOperation(operation, caller).finally(() => { this.dataPending = undefined; });
      return this.dataPending;
    }
    const read = ['getAcquisitionProgress', 'getSharedSnapshot', 'getSharedMetadata', 'bootstrap'].includes(operation);
    if (this.stopping || this.restartPending || !read && !checkpoint && (this.lifecycle ? this.lifecycle.blocks(caller) : this.dataPending)) return { ok: false, error: { code: 'DATA_BUSY' } };
    if (operation === 'getAcquisitionProgress') return args.length === 0
      ? { ok: true, value: this.acquisition?.current() ?? null } : { ok: false, error: { code: 'INVALID_REQUEST' } };
    if (operation === 'cancelAcquisition') {
      if (args.length !== 1 || !isCancelAcquisitionRequest(args[0])) return { ok: false, error: { code: 'INVALID_REQUEST' } };
      return this.acquisition?.cancel(args[0].operationId) ?? { ok: false, error: { code: 'NOT_FOUND' } };
    }
    if (operation === 'openSource') return this.openSource(args);
    if (operation === 'openCommentAction') return this.openCommentAction(args);
    if (operation === 'getThumbnail' || operation === 'checkThumbnail' || operation === 'openThumbnail') return this.thumbnail(operation, args);
    if (operation === 'getHelperStatus' || operation === 'chooseHelper' || operation === 'clearHelper') {
      if (args.length !== 1 || !isHelperRequest(args[0])) return Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
      if (!this.helpers) return Promise.resolve({ ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } });
      const kind = args[0].kind;
      const pending = operation === 'getHelperStatus' ? this.helpers.getStatus(kind)
        : operation === 'chooseHelper' ? this.helpers.choose(kind, caller) : this.helpers.clear(kind);
      return pending.then(result => {
        if (result.ok && result.value) {
          const evidence = JSON.stringify(result.value), previous = this.helperEvidence.get(kind);
          if (operation === 'getHelperStatus' && previous !== undefined && evidence !== previous) this.repository?.invalidateHelperStatus();
          this.helperEvidence.set(kind, evidence);
        }
        return result;
      }).catch(error => { this.diagnose(error); return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; });
    }
    if (operation === 'acquire' || operation === 'refresh') {
      if (args.length !== 1 || (operation === 'acquire' ? !isAcquireRequest(args[0]) : !isRefreshRequest(args[0]))) {
        return Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
      }
      if (!this.acquisition) return Promise.resolve({ ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } });
      if (operation === 'refresh' && isRefreshRequest(args[0])) {
        try {
          const item = this.repository?.getStoredItem(args[0].itemId);
          if (item) void this.thumbnails?.cache.check(item, true).catch(() => undefined);
        } catch { /* Presentation lookup must never fail comment Refresh. */ }
      }
      return operation === 'acquire' && isAcquireRequest(args[0]) ? this.acquisition.acquire(args[0].url)
        : isRefreshRequest(args[0]) ? this.acquisition.refresh(args[0].itemId) : Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    if ((['bootstrap', 'getSharedMetadata', 'openLibrary', 'openSettings'].includes(operation) && args.length !== 0)
      || (operation === 'setDiscussionCollapse' && (args.length !== 1 || !isSetDiscussionCollapseRequest(args[0])))
      || (operation === 'saveDiscussionView' && (args.length !== 1 || !isSaveDiscussionViewRequest(args[0])))
      || (operation === 'toggleSeen' && (args.length !== 1 || !isToggleSeenRequest(args[0])))
      || (operation === 'bulkSeen' && (args.length !== 1 || !isBulkSeenRequest(args[0])))
      || (operation === 'getSharedSnapshot' && (args.length > 1 || args.length === 1 && !isRefreshRequest(args[0])))
      || (operation === 'undoSeen' && (args.length !== 1 || !isUndoSeenRequest(args[0])))
      || (['openStoredItem', 'removeLibraryItem'].includes(operation) && (args.length !== 1 || !isRefreshRequest(args[0])))
      || (['activateTab', 'closeTab'].includes(operation) && (args.length !== 1 || !isTabRequest(args[0])))
      || (operation === 'moveTab' && (args.length !== 1 || !isMoveTabRequest(args[0])))
      || (operation === 'updatePreferences' && (args.length !== 1 || !isPreferenceChange(args[0])))) {
      return { ok: false, error: { code: 'INVALID_REQUEST' } };
    }
    if ((operation === 'bootstrap' || operation === 'getSharedSnapshot') && !this.repository && this.failure === 'STORAGE_UNAVAILABLE') this.initializeStorage();
    if (!this.repository) return { ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } };
    try {
      let value: SharedSnapshot | SharedItemSnapshot | SharedMetadata | ReaderState | SeenMutationResult | Preferences | WorkspaceState | null;
      if (operation === 'getSharedSnapshot') value = args.length === 1 && isRefreshRequest(args[0]) ? this.repository.itemSnapshot(args[0].itemId) : { ...this.repository.stamp(), state: this.repository.bootstrap(this.languages) };
      else if (operation === 'getSharedMetadata') value = { ...this.repository.stamp(), preferences: this.repository.preferences(this.languages), workspace: this.repository.workspace() };
      else if (operation === 'bootstrap') value = this.repository.bootstrap(this.languages);
      else if (operation === 'setDiscussionCollapse' && isSetDiscussionCollapseRequest(args[0])) value = this.repository.setDiscussionCollapse(args[0]);
      else if (operation === 'saveDiscussionView' && isSaveDiscussionViewRequest(args[0])) value = this.repository.saveDiscussionView(args[0]);
      else if (operation === 'toggleSeen' && isToggleSeenRequest(args[0])) value = this.repository.toggleSeen(args[0]);
      else if (operation === 'bulkSeen' && isBulkSeenRequest(args[0])) value = this.repository.bulkSeen(args[0]);
      else if (operation === 'undoSeen' && isUndoSeenRequest(args[0])) value = this.repository.undoSeen(args[0].itemId, args[0].expectedOperationId);
      else if (operation === 'updatePreferences' && isPreferenceChange(args[0])) value = this.repository.updatePreferences(args[0], this.languages);
      else if (operation === 'removeLibraryItem' && isRefreshRequest(args[0])) {
        const itemId = args[0].itemId;
        const item = this.repository.bootstrap(this.languages).items.find(item => item.id === itemId);
        if (item && this.acquisition?.owns(item.sourceKind, item.sourceId)) return { ok: false, error: { code: 'ACQUISITION_BUSY' } };
        value = this.repository.removeLibraryItem(args[0].itemId, this.languages);
        for (const [token, grant] of this.thumbnailGrants) if (grant.itemId === itemId) this.thumbnailGrants.delete(token);
        if (item?.kind === 'video') void this.thumbnails?.cache.remove(item.sourceId, () => !this.repository || this.repository.hasVideoReference(item.sourceId)).catch(() => undefined);
      }
      else if (operation === 'openStoredItem' && isRefreshRequest(args[0])) value = this.repository.changeWorkspace(operation, args[0].itemId);
      else if ((operation === 'activateTab' || operation === 'closeTab') && isTabRequest(args[0])) value = this.repository.changeWorkspace(operation, args[0].tabId);
      else if (operation === 'moveTab' && isMoveTabRequest(args[0])) value = this.repository.changeWorkspace(operation, args[0].tabId, args[0].toIndex);
      else if (operation === 'openLibrary' || operation === 'openSettings') value = this.repository.changeWorkspace(operation);
      else return { ok: false, error: { code: 'INVALID_REQUEST' } };
      return { ok: true, value };
    } catch (error) {
      if (!(error instanceof UndoConflictError)) this.diagnose(error);
      return { ok: false, error: { code: error instanceof UndoConflictError ? 'UNDO_CONFLICT' : error instanceof MissingCommentError ? 'NOT_FOUND' : error instanceof NotRemovableError ? 'NOT_REMOVABLE' : error instanceof InvalidWorkspaceMoveError || error instanceof InvalidSeenTargetError || error instanceof InvalidDiscussionViewError || error instanceof InvalidPreferenceError ? 'INVALID_REQUEST' : 'STORAGE_UNAVAILABLE' } };
    }
  }
  private async thumbnail(operation: 'getThumbnail' | 'checkThumbnail' | 'openThumbnail', args: readonly unknown[]): Promise<Result<string | null>> {
    if (args.length !== 1 || !isRefreshRequest(args[0])) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    const itemId = args[0].itemId;
    try {
      const item = this.repository?.getStoredItem(itemId);
      if (!item) return { ok: false, error: { code: 'NOT_FOUND' } };
      if (!this.thumbnails) return { ok: true, value: null };
      const value = await (operation === 'checkThumbnail' ? this.thumbnails.cache.check(item) : this.thumbnails.cache.cached(item));
      const current = this.repository?.getStoredItem(itemId);
      if (!current || current.sourceId !== item.sourceId || current.kind !== 'video' || current.isDemo) return { ok: true, value: null };
      if (!value) return operation === 'openThumbnail' ? { ok: false, error: { code: 'NOT_OPENABLE' } } : { ok: true, value: null };
      if (operation === 'openThumbnail') {
        const image = await this.thumbnails.cache.read(value);
        if (!image) return { ok: false, error: { code: 'NOT_OPENABLE' } };
        if (await this.thumbnails.openPath(image.file)) return { ok: false, error: { code: 'SOURCE_OPEN_FAILED' } };
        return { ok: true, value: null };
      }
      for (const [token, grant] of this.thumbnailGrants) if (grant.itemId === itemId && grant.value.digest === value.digest && grant.value.videoId === value.videoId) return { ok: true, value: `reader-thumbnail://cache/${token}` };
      // Bounded runtime capabilities; no disk paths, remote URLs or binary IPC.
      for (const [token, grant] of this.thumbnailGrants) if (grant.itemId === itemId) this.thumbnailGrants.delete(token);
      const oldest = this.thumbnailGrants.keys().next().value;
      if (this.thumbnailGrants.size >= 256 && oldest) this.thumbnailGrants.delete(oldest);
      const token = randomUUID(); this.thumbnailGrants.set(token, { itemId, value });
      return { ok: true, value: `reader-thumbnail://cache/${token}` };
    } catch { return { ok: false, error: { code: operation === 'openThumbnail' ? 'SOURCE_OPEN_FAILED' : 'NOT_OPENABLE' } }; }
  }
  /** Opaque image-only protocol capability, rechecked against current stored
   * canonical identity on every read (including removal/restore races). */
  async thumbnailImage(url: string): Promise<{ bytes: Buffer; mime: string } | undefined> {
    const token = /^reader-thumbnail:\/\/cache\/([a-f0-9-]{36})$/.exec(url)?.[1];
    const grant = token ? this.thumbnailGrants.get(token) : undefined;
    if (!grant || this.stopping || this.restartPending || this.dataPending) return undefined;
    const item = this.repository?.getStoredItem(grant.itemId);
    if (!item || item.kind !== 'video' || item.isDemo || item.sourceKind !== 'youtube-video' || item.sourceId !== grant.value.videoId) return undefined;
    return this.thumbnails?.cache.read(grant.value);
  }
  private async runDataOperation(operation: 'createBackup' | 'restoreBackup', caller?: ReaderCallerContext): Promise<Result<DataBackupResult>> {
    const options = this.dataOptions, repository = this.repository;
    if (!options || !repository) return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } };
    const originLost = () => caller !== undefined && !caller.isCurrent();
    let closed = false, settled = false;
    try {
      if (operation === 'createBackup' && this.acquisition?.current()) return { ok: false, error: { code: 'DATA_BUSY' } };
      if (this.lifecycle) { await this.lifecycle.begin(operation === 'createBackup' ? 'backup' : 'restore'); this.lifecycle.executePhase(); }
      const locale = repository.preferences(this.languages).locale;
      if (operation === 'createBackup') {
        if (this.acquisition?.current()) return { ok: false, error: { code: 'DATA_BUSY' } };
        await this.helpers?.settle();
        if (this.stopping || originLost()) return { ok: true, value: { status: 'cancelled' } };
        const destination = await options.dialogs.save(locale, caller);
        if (!destination || this.stopping || originLost()) return { ok: true, value: { status: 'cancelled' } };
        await validateBackupDestination(destination, options.databasePath);
        if (originLost()) return { ok: true, value: { status: 'cancelled' } };
        this.lifecycle?.accept();
        await repository.createBackup(destination);
        return { ok: true, value: { status: 'created', destination } };
      }
      const source = await options.dialogs.select(locale, caller);
      if (!source || this.stopping || originLost()) return { ok: true, value: { status: 'cancelled' } };
      const directory = await prepareRestore(source, options.databasePath, options.checkpoint);
      if (this.stopping || originLost() || !await options.dialogs.confirm(locale, caller) || this.stopping || originLost()) return { ok: true, value: { status: 'cancelled' } };
      // Main rejected new ordinary mutations before global preparation. Enrolled
      // queues have now drained under their exact capabilities; settle accepted
      // main-owned work before the independent safety snapshot.
      settled = true;
      this.lifecycle?.accept();
      await Promise.all([this.acquisition?.close(), this.helpers?.shutdown(), this.thumbnails?.cache.settle()]);
      await repository.createBackup(path.join(directory, 'safety.sqlite'));
      await options.checkpoint?.('safety');
      // Terminal fencing precedes the first offline storage action, including failures.
      this.restartPending = true; this.lifecycle?.restarting();
      repository.prepareOffline(); repository.close(); this.repository = undefined; closed = true;
      await installRestore(options.databasePath, directory, options.checkpoint);
      this.restartPending = true;
      setImmediate(options.restart);
      return { ok: true, value: { status: 'restarting' } };
    } catch (error) {
      this.diagnose(error);
      if (closed || this.restartPending) {
        // Startup recovers offline before any opener/seed, then acknowledges the
        // result in a fresh process. Never reuse old renderer or service state.
        this.restartPending = true; setImmediate(options.restart);
        return { ok: false, error: { code: 'RECOVERY_REQUIRED' } };
      }
      this.lifecycle?.release(true);
      if (settled) {
        this.helpers = new HelperSettingsService(repository, this.helperOptions);
        this.acquisition = new AcquisitionService(repository, this.languages,
          this.extract ?? createLiveExtractor({ resolve: this.helpers.resolve, execute: this.helperOptions.execute }), this.notifyProgress);
      }
      return { ok: false, error: { code: error instanceof BackupValidationError ? error.reason
        : operation === 'createBackup' ? 'DATA_WRITE_FAILED' : 'RESTORE_FAILED' } };
    } finally {
      if (!this.restartPending) this.lifecycle?.release();
    }
  }
  private async openSource(args: readonly unknown[]): Promise<Result<null>> {
    if (args.length !== 1 || !isRefreshRequest(args[0])) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    if (!this.repository) return { ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } };
    let url: string | undefined;
    try {
      const item = this.repository.getStoredItem(args[0].itemId);
      if (!item) return { ok: false, error: { code: 'NOT_FOUND' } };
      url = sourceUrl(item);
    } catch (error) { this.diagnose(error); return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
    if (!url) return { ok: false, error: { code: 'NOT_OPENABLE' } };
    try {
      if (!this.openBrowser) throw new Error('Browser capability unavailable');
      await this.openBrowser(url);
      return { ok: true, value: null };
    } catch (error) { this.diagnose(error); return { ok: false, error: { code: 'SOURCE_OPEN_FAILED' } }; }
  }
  private async openCommentAction(args: readonly unknown[]): Promise<Result<null>> {
    if (args.length !== 1 || !isCommentActionRequest(args[0])) return { ok: false, error: { code: 'INVALID_REQUEST' } };
    if (!this.repository) return { ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } };
    const { itemId, commentId, action } = args[0];
    let url: string | undefined;
    try {
      const item = this.repository.getStoredItem(itemId);
      if (!item) return { ok: false, error: { code: 'NOT_FOUND' } };
      const comment = this.repository.getActionComment(item, commentId);
      if (!comment) return { ok: false, error: { code: 'NOT_FOUND' } };
      if (!commentActionAvailability(item, comment)[action === 'copy-permalink' ? 'permalink' : action]) return { ok: false, error: { code: 'NOT_OPENABLE' } };
      url = action === 'author' ? authorUrl(comment.author) : action === 'permalink' || action === 'copy-permalink' ? commentPermalink(item, comment)
        : translationUrl(comment.text, this.repository.preferences(this.languages));
      if (!url) return { ok: false, error: { code: action === 'translate' ? 'TRANSLATION_TOO_LONG' : 'NOT_OPENABLE' } };
    } catch { return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; }
    try {
      if (action === 'copy-permalink') {
        if (!this.copyText) return { ok: false, error: { code: 'SOURCE_OPEN_FAILED' } };
        await this.copyText(url); return { ok: true, value: null };
      }
      if (!this.openBrowser) return { ok: false, error: { code: 'SOURCE_OPEN_FAILED' } };
      await this.openBrowser(url);
      return { ok: true, value: null };
    } catch {
      // Browser errors can include the URL and comment text. Never diagnose them.
      return { ok: false, error: { code: 'SOURCE_OPEN_FAILED' } };
    }
  }
  /** Synchronous idle-only test cleanup. Runtime quit uses shutdown to await children. */
  close(): void { void this.acquisition?.close(); void this.helpers?.shutdown(); this.repository?.close(); }
  /** Await child termination and workspace cleanup before releasing the database. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    await this.dataPending;
    await Promise.all([this.acquisition?.close(), this.helpers?.shutdown(), this.thumbnails?.cache.shutdown()]);
    this.repository?.close(); this.repository = undefined;
  }
}
