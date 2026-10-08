import { isPreferenceChange, isToggleSeenRequest, isAcquireRequest, isRefreshRequest, isTabRequest, isMoveTabRequest, isBulkSeenRequest, isHelperRequest } from '../shared/reader-api';
import type { AcquisitionResult, ReaderOperation, ReaderState, Result } from '../shared/reader-api';
import type { SeenMutationResult, SeenUndoResult } from '../domain/seen-operation';
import type { Preferences } from '../shared/preferences';
import { ReaderRepository, MissingCommentError, NotRemovableError, InvalidSeenTargetError } from './persistence/reader-repository';
import { UnsupportedSchemaError } from './persistence/migrations';
import { AcquisitionService } from './acquisition-service';
import { createLiveExtractor } from './live-extraction';
import type { ExtractLive } from './live-extraction';
import { InvalidWorkspaceMoveError } from '../domain/workspace';
import type { WorkspaceState } from '../domain/workspace';
import type { HelperStatus } from '../shared/helper-settings';
import { HelperSettingsService } from './helper-settings';
import type { HelperSettingsOptions } from './helper-settings';

/** Small use-case boundary: validate before touching persistence; failures carry
 * stable codes. Diagnostics are reported only on the privileged side. */
export class ReaderService {
  private repository?: ReaderRepository;
  private acquisition?: AcquisitionService;
  private helpers?: HelperSettingsService;
  private failure?: 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED_SCHEMA';
  constructor(private readonly open: () => ReaderRepository, private readonly languages: readonly string[],
    private readonly diagnose: (error: unknown) => void = console.error,
    private readonly extract?: ExtractLive,
    private readonly helperOptions: HelperSettingsOptions = {}) {
    this.initializeStorage();
  }

  /** Reuse the same safe open/demo-initialization path on recoverable bootstrap
   * retries. A successful repository is retained; unsupported schemas stay closed. */
  private initializeStorage(): void {
    try {
      this.repository = this.open();
      this.helpers = new HelperSettingsService(this.repository, this.helperOptions);
      this.acquisition = new AcquisitionService(this.repository, this.languages,
        this.extract ?? createLiveExtractor({ resolve: this.helpers.resolve, execute: this.helperOptions.execute }));
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
  dispatch(operation: ReaderOperation, args: readonly unknown[]): Result<ReaderState | SeenMutationResult | Preferences | WorkspaceState> | Promise<Result<AcquisitionResult | HelperStatus | null>>;
  dispatch(operation: ReaderOperation, args: readonly unknown[]): Result<ReaderState | SeenMutationResult | Preferences | WorkspaceState> | Promise<Result<AcquisitionResult | HelperStatus | null>> {
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
      let value: ReaderState | SeenMutationResult | Preferences | WorkspaceState;
      if (operation === 'bootstrap') value = this.repository.bootstrap(this.languages);
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
      return { ok: false, error: { code: error instanceof MissingCommentError ? 'NOT_FOUND' : error instanceof NotRemovableError ? 'NOT_REMOVABLE' : error instanceof InvalidWorkspaceMoveError || error instanceof InvalidSeenTargetError ? 'INVALID_REQUEST' : 'STORAGE_UNAVAILABLE' } };
    }
  }
  /** Synchronous idle-only test cleanup. Runtime quit uses shutdown to await children. */
  close(): void { void this.acquisition?.close(); void this.helpers?.shutdown(); this.repository?.close(); }
  /** Await child termination and workspace cleanup before releasing the database. */
  async shutdown(): Promise<void> {
    await Promise.all([this.acquisition?.close(), this.helpers?.shutdown()]);
    this.repository?.close();
  }
}
