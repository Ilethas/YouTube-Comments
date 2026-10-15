import { isCancelAcquisitionRequest } from '../shared/acquisition';
import type { AcquisitionNotification, AcquisitionProgress } from '../shared/acquisition';
import { isPreferenceChange, isToggleSeenRequest, isAcquireRequest, isRefreshRequest, isTabRequest, isMoveTabRequest, isBulkSeenRequest, isHelperRequest } from '../shared/reader-api';
import type { AcquisitionResult, ReaderOperation, ReaderState, Result } from '../shared/reader-api';
import type { SeenMutationResult, SeenUndoResult } from '../domain/seen-operation';
import type { Preferences } from '../shared/preferences';
import { ReaderRepository, MissingCommentError, NotRemovableError, InvalidSeenTargetError, InvalidDiscussionViewError } from './persistence/reader-repository';
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
import path from 'node:path';
import type { DataBackupResult } from '../shared/data-backup';
import type { DataBackupDialogs } from './data-backup-dialogs';
import { BackupValidationError } from './persistence/backup-validation';
import { validateBackupDestination } from './persistence/sqlite-backup';
import { installRestore, prepareRestore } from './persistence/profile-restore';
import type { RestoreCheckpoint } from './persistence/profile-restore';

export interface DataBackupOptions {
  readonly databasePath: string;
  readonly dialogs: DataBackupDialogs;
  readonly restart: () => void;
  readonly checkpoint?: RestoreCheckpoint;
}
type ServiceValue = ReaderState | SeenMutationResult | Preferences | WorkspaceState | AcquisitionProgress | AcquisitionResult | HelperStatus | DataBackupResult | null;

/** Small use-case boundary: validate before touching persistence; failures carry
 * stable codes. Diagnostics are reported only on the privileged side. */
export class ReaderService {
  private repository?: ReaderRepository;
  private acquisition?: AcquisitionService;
  private helpers?: HelperSettingsService;
  private failure?: 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED_SCHEMA';
  private dataPending?: Promise<Result<DataBackupResult>>;
  private stopping = false;
  private restartPending = false;
  constructor(private readonly open: () => ReaderRepository, private readonly languages: readonly string[],
    private readonly diagnose: (error: unknown) => void = console.error,
    private readonly extract?: ExtractLive,
    private readonly helperOptions: HelperSettingsOptions = {},
    private readonly openBrowser?: (url: string) => Promise<void>,
    private readonly notifyProgress: (value: AcquisitionNotification) => void = () => undefined,
    private readonly dataOptions?: DataBackupOptions) {
    this.initializeStorage();
  }

  /** Reuse the same safe open/demo-initialization path on recoverable bootstrap
   * retries. A successful repository is retained; unsupported schemas stay closed. */
  private initializeStorage(): void {
    try {
      this.repository = this.open();
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

  /** args preserve arity validation even for bootstrap's payload-free query. */
  dispatch(operation: 'bootstrap' | 'removeLibraryItem', args: readonly unknown[]): Result<ReaderState>;
  dispatch(operation: 'toggleSeen' | 'bulkSeen', args: readonly unknown[]): Result<SeenMutationResult>;
  dispatch(operation: 'undoSeen', args: readonly unknown[]): Result<SeenUndoResult>;
  dispatch(operation: 'updatePreferences', args: readonly unknown[]): Result<Preferences>;
  dispatch(operation: 'openStoredItem' | 'activateTab' | 'closeTab' | 'openLibrary' | 'openSettings' | 'moveTab', args: readonly unknown[]): Result<WorkspaceState>;
  dispatch(operation: 'acquire' | 'refresh', args: readonly unknown[]): Promise<Result<AcquisitionResult>>;
  dispatch(operation: 'getHelperStatus' | 'clearHelper', args: readonly unknown[]): Promise<Result<HelperStatus>>;
  dispatch(operation: 'chooseHelper', args: readonly unknown[]): Promise<Result<HelperStatus | null>>;
  dispatch(operation: 'openSource', args: readonly unknown[]): Promise<Result<null>>;
  dispatch(operation: 'getAcquisitionProgress', args: readonly unknown[]): Result<AcquisitionProgress | null>;
  dispatch(operation: 'cancelAcquisition', args: readonly unknown[]): Result<null>;
  dispatch(operation: 'saveDiscussionView', args: readonly unknown[]): Result<null>;
  dispatch(operation: 'createBackup' | 'restoreBackup', args: readonly unknown[]): Promise<Result<DataBackupResult>>;
  dispatch(operation: ReaderOperation, args: readonly unknown[]): Result<ServiceValue> | Promise<Result<ServiceValue>>;
  dispatch(operation: ReaderOperation, args: readonly unknown[]): Result<ServiceValue> | Promise<Result<ServiceValue>> {
    if (operation === 'createBackup' || operation === 'restoreBackup') {
      if (args.length !== 0) return Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
      if (this.dataPending || this.stopping || this.restartPending) return Promise.resolve({ ok: false, error: { code: 'DATA_BUSY' } });
      this.dataPending = this.runDataOperation(operation).finally(() => { this.dataPending = undefined; });
      return this.dataPending;
    }
    if (this.stopping || this.restartPending || this.dataPending && operation !== 'getAcquisitionProgress') return { ok: false, error: { code: 'DATA_BUSY' } };
    if (operation === 'getAcquisitionProgress') return args.length === 0
      ? { ok: true, value: this.acquisition?.current() ?? null } : { ok: false, error: { code: 'INVALID_REQUEST' } };
    if (operation === 'cancelAcquisition') {
      if (args.length !== 1 || !isCancelAcquisitionRequest(args[0])) return { ok: false, error: { code: 'INVALID_REQUEST' } };
      return this.acquisition?.cancel(args[0].operationId) ?? { ok: false, error: { code: 'NOT_FOUND' } };
    }
    if (operation === 'openSource') return this.openSource(args);
    if (operation === 'getHelperStatus' || operation === 'chooseHelper' || operation === 'clearHelper') {
      if (args.length !== 1 || !isHelperRequest(args[0])) return Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
      if (!this.helpers) return Promise.resolve({ ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } });
      const kind = args[0].kind;
      const pending = operation === 'getHelperStatus' ? this.helpers.getStatus(kind)
        : operation === 'chooseHelper' ? this.helpers.choose(kind) : this.helpers.clear(kind);
      return pending.catch(error => { this.diagnose(error); return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }; });
    }
    if (operation === 'acquire' || operation === 'refresh') {
      if (args.length !== 1 || (operation === 'acquire' ? !isAcquireRequest(args[0]) : !isRefreshRequest(args[0]))) {
        return Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
      }
      if (!this.acquisition) return Promise.resolve({ ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } });
      return operation === 'acquire' && isAcquireRequest(args[0]) ? this.acquisition.acquire(args[0].url)
        : isRefreshRequest(args[0]) ? this.acquisition.refresh(args[0].itemId) : Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    if ((['bootstrap', 'openLibrary', 'openSettings'].includes(operation) && args.length !== 0)
      || (operation === 'saveDiscussionView' && (args.length !== 1 || !isSaveDiscussionViewRequest(args[0])))
      || (operation === 'toggleSeen' && (args.length !== 1 || !isToggleSeenRequest(args[0])))
      || (operation === 'bulkSeen' && (args.length !== 1 || !isBulkSeenRequest(args[0])))
      || (['openStoredItem', 'removeLibraryItem', 'undoSeen'].includes(operation) && (args.length !== 1 || !isRefreshRequest(args[0])))
      || (['activateTab', 'closeTab'].includes(operation) && (args.length !== 1 || !isTabRequest(args[0])))
      || (operation === 'moveTab' && (args.length !== 1 || !isMoveTabRequest(args[0])))
      || (operation === 'updatePreferences' && (args.length !== 1 || !isPreferenceChange(args[0])))) {
      return { ok: false, error: { code: 'INVALID_REQUEST' } };
    }
    if (operation === 'bootstrap' && !this.repository && this.failure === 'STORAGE_UNAVAILABLE') this.initializeStorage();
    if (!this.repository) return { ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } };
    try {
      let value: ReaderState | SeenMutationResult | Preferences | WorkspaceState | null;
      if (operation === 'bootstrap') value = this.repository.bootstrap(this.languages);
      else if (operation === 'saveDiscussionView' && isSaveDiscussionViewRequest(args[0])) value = this.repository.saveDiscussionView(args[0]);
      else if (operation === 'toggleSeen' && isToggleSeenRequest(args[0])) value = this.repository.toggleSeen(args[0]);
      else if (operation === 'bulkSeen' && isBulkSeenRequest(args[0])) value = this.repository.bulkSeen(args[0]);
      else if (operation === 'undoSeen' && isRefreshRequest(args[0])) value = this.repository.undoSeen(args[0].itemId);
      else if (operation === 'updatePreferences' && isPreferenceChange(args[0])) value = this.repository.updatePreferences(args[0], this.languages);
      else if (operation === 'removeLibraryItem' && isRefreshRequest(args[0])) {
        const itemId = args[0].itemId;
        const item = this.repository.bootstrap(this.languages).items.find(item => item.id === itemId);
        if (item && this.acquisition?.owns(item.sourceKind, item.sourceId)) return { ok: false, error: { code: 'ACQUISITION_BUSY' } };
        value = this.repository.removeLibraryItem(args[0].itemId, this.languages);
      }
      else if (operation === 'openStoredItem' && isRefreshRequest(args[0])) value = this.repository.changeWorkspace(operation, args[0].itemId);
      else if ((operation === 'activateTab' || operation === 'closeTab') && isTabRequest(args[0])) value = this.repository.changeWorkspace(operation, args[0].tabId);
      else if (operation === 'moveTab' && isMoveTabRequest(args[0])) value = this.repository.changeWorkspace(operation, args[0].tabId, args[0].toIndex);
      else if (operation === 'openLibrary' || operation === 'openSettings') value = this.repository.changeWorkspace(operation);
      else return { ok: false, error: { code: 'INVALID_REQUEST' } };
      return { ok: true, value };
    } catch (error) {
      this.diagnose(error);
      return { ok: false, error: { code: error instanceof MissingCommentError ? 'NOT_FOUND' : error instanceof NotRemovableError ? 'NOT_REMOVABLE' : error instanceof InvalidWorkspaceMoveError || error instanceof InvalidSeenTargetError || error instanceof InvalidDiscussionViewError ? 'INVALID_REQUEST' : 'STORAGE_UNAVAILABLE' } };
    }
  }
  private async runDataOperation(operation: 'createBackup' | 'restoreBackup'): Promise<Result<DataBackupResult>> {
    const options = this.dataOptions, repository = this.repository;
    if (!options || !repository) return { ok: false, error: { code: 'STORAGE_UNAVAILABLE' } };
    let closed = false, settled = false;
    try {
      const locale = repository.preferences(this.languages).locale;
      if (operation === 'createBackup') {
        if (this.acquisition?.current()) return { ok: false, error: { code: 'DATA_BUSY' } };
        await this.helpers?.settle();
        if (this.stopping) return { ok: true, value: { status: 'cancelled' } };
        const destination = await options.dialogs.save(locale);
        if (!destination || this.stopping) return { ok: true, value: { status: 'cancelled' } };
        await validateBackupDestination(destination, options.databasePath);
        await repository.createBackup(destination);
        return { ok: true, value: { status: 'created', destination } };
      }
      const source = await options.dialogs.select(locale);
      if (!source || this.stopping) return { ok: true, value: { status: 'cancelled' } };
      const directory = await prepareRestore(source, options.databasePath, options.checkpoint);
      if (this.stopping || !await options.dialogs.confirm(locale) || this.stopping) return { ok: true, value: { status: 'cancelled' } };
      // Main has rejected new IPC mutations since this operation began. Accepted
      // renderer queues were flushed before invocation; now settle all children
      // and any earlier helper selection before the safety snapshot.
      settled = true;
      await Promise.all([this.acquisition?.close(), this.helpers?.shutdown()]);
      await repository.createBackup(path.join(directory, 'safety.sqlite'));
      await options.checkpoint?.('safety');
      repository.prepareOffline(); repository.close(); this.repository = undefined; closed = true;
      await installRestore(options.databasePath, directory, options.checkpoint);
      this.restartPending = true;
      setImmediate(options.restart);
      return { ok: true, value: { status: 'restarting' } };
    } catch (error) {
      this.diagnose(error);
      if (closed) {
        // Startup recovers offline before any opener/seed, then acknowledges the
        // result in a fresh process. Never reuse old renderer or service state.
        this.restartPending = true; setImmediate(options.restart);
        return { ok: false, error: { code: 'RECOVERY_REQUIRED' } };
      }
      if (settled) {
        this.helpers = new HelperSettingsService(repository, this.helperOptions);
        this.acquisition = new AcquisitionService(repository, this.languages,
          this.extract ?? createLiveExtractor({ resolve: this.helpers.resolve, execute: this.helperOptions.execute }), this.notifyProgress);
      }
      return { ok: false, error: { code: error instanceof BackupValidationError ? error.reason
        : operation === 'createBackup' ? 'DATA_WRITE_FAILED' : 'RESTORE_FAILED' } };
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
  /** Synchronous idle-only test cleanup. Runtime quit uses shutdown to await children. */
  close(): void { void this.acquisition?.close(); void this.helpers?.shutdown(); this.repository?.close(); }
  /** Await child termination and workspace cleanup before releasing the database. */
  async shutdown(): Promise<void> {
    this.stopping = true;
    await this.dataPending;
    await Promise.all([this.acquisition?.close(), this.helpers?.shutdown()]);
    this.repository?.close(); this.repository = undefined;
  }
}
