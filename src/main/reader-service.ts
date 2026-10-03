import { isPreferenceChange, isToggleSeenRequest, isAcquireRequest, isRefreshRequest } from '../shared/reader-api';
import type { AcquisitionResult, ReaderOperation, ReaderState, Result } from '../shared/reader-api';
import type { Comment } from '../domain/discussion';
import type { Preferences } from '../shared/preferences';
import { ReaderRepository, MissingCommentError } from './persistence/reader-repository';
import { UnsupportedSchemaError } from './persistence/migrations';
import { AcquisitionService } from './acquisition-service';
import { createLiveExtractor } from './live-extraction';
import type { ExtractLive } from './live-extraction';
import type { WorkspaceState } from '../domain/workspace';

/** Small use-case boundary: validate before touching persistence; failures carry
 * stable codes. Diagnostics are reported only on the privileged side. */
export class ReaderService {
  private repository?: ReaderRepository;
  private acquisition?: AcquisitionService;
  private failure?: 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED_SCHEMA';
  constructor(private readonly open: () => ReaderRepository, private readonly languages: readonly string[],
    private readonly diagnose: (error: unknown) => void = console.error,
    private readonly extract: ExtractLive = createLiveExtractor()) {
    this.initializeStorage();
  }

  /** Reuse the same safe open/demo-initialization path on recoverable bootstrap
   * retries. A successful repository is retained; unsupported schemas stay closed. */
  private initializeStorage(): void {
    try {
      this.repository = this.open();
      this.acquisition = new AcquisitionService(this.repository, this.languages, this.extract);
      this.failure = undefined;
    }
    catch (error) {
      this.failure = error instanceof UnsupportedSchemaError ? 'UNSUPPORTED_SCHEMA' : 'STORAGE_UNAVAILABLE';
      this.diagnose(error);
    }
  }

  /** args preserve arity validation even for bootstrap's payload-free query. */
  dispatch(operation: 'bootstrap', args: readonly unknown[]): Result<ReaderState>;
  dispatch(operation: 'toggleSeen', args: readonly unknown[]): Result<readonly Comment[]>;
  dispatch(operation: 'updatePreferences', args: readonly unknown[]): Result<Preferences>;
  dispatch(operation: 'openStoredItem' | 'activateTab' | 'closeTab', args: readonly unknown[]): Result<WorkspaceState>;
  dispatch(operation: 'acquire' | 'refresh', args: readonly unknown[]): Promise<Result<AcquisitionResult>>;
  dispatch(operation: ReaderOperation, args: readonly unknown[]): Result<ReaderState | readonly Comment[] | Preferences | WorkspaceState> | Promise<Result<AcquisitionResult>>;
  dispatch(operation: ReaderOperation, args: readonly unknown[]): Result<ReaderState | readonly Comment[] | Preferences | WorkspaceState> | Promise<Result<AcquisitionResult>> {
    if (operation === 'acquire' || operation === 'refresh') {
      if (args.length !== 1 || (operation === 'acquire' ? !isAcquireRequest(args[0]) : !isRefreshRequest(args[0]))) {
        return Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
      }
      if (!this.acquisition) return Promise.resolve({ ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } });
      return operation === 'acquire' && isAcquireRequest(args[0]) ? this.acquisition.acquire(args[0].url)
        : isRefreshRequest(args[0]) ? this.acquisition.refresh(args[0].itemId) : Promise.resolve({ ok: false, error: { code: 'INVALID_REQUEST' } });
    }
    if ((operation === 'bootstrap' && args.length !== 0)
      || (operation === 'toggleSeen' && (args.length !== 1 || !isToggleSeenRequest(args[0])))
      || (['openStoredItem', 'activateTab', 'closeTab'].includes(operation) && (args.length !== 1 || !isRefreshRequest(args[0])))
      || (operation === 'updatePreferences' && (args.length !== 1 || !isPreferenceChange(args[0])))) {
      return { ok: false, error: { code: 'INVALID_REQUEST' } };
    }
    if (operation === 'bootstrap' && !this.repository && this.failure === 'STORAGE_UNAVAILABLE') this.initializeStorage();
    if (!this.repository) return { ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } };
    try {
      let value: ReaderState | readonly Comment[] | Preferences | WorkspaceState;
      if (operation === 'bootstrap') value = this.repository.bootstrap(this.languages);
      else if (operation === 'toggleSeen' && isToggleSeenRequest(args[0])) value = this.repository.toggleSeen(args[0]);
      else if (operation === 'updatePreferences' && isPreferenceChange(args[0])) value = this.repository.updatePreferences(args[0], this.languages);
      else if ((operation === 'openStoredItem' || operation === 'activateTab' || operation === 'closeTab') && isRefreshRequest(args[0])) value = this.repository.changeWorkspace(operation, args[0].itemId);
      else return { ok: false, error: { code: 'INVALID_REQUEST' } };
      return { ok: true, value };
    } catch (error) {
      this.diagnose(error);
      return { ok: false, error: { code: error instanceof MissingCommentError ? 'NOT_FOUND' : 'STORAGE_UNAVAILABLE' } };
    }
  }
  close(): void { void this.acquisition?.close(); this.repository?.close(); }
  /** Await child termination and workspace cleanup before releasing the database. */
  async shutdown(): Promise<void> { await this.acquisition?.close(); this.repository?.close(); }
}
