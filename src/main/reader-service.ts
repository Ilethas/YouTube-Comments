import { isPreferenceChange, isToggleSeenRequest } from '../shared/reader-api';
import type { ReaderOperation, ReaderState, Result } from '../shared/reader-api';
import type { Comment } from '../domain/discussion';
import type { Preferences } from '../shared/preferences';
import { ReaderRepository, MissingCommentError } from './persistence/reader-repository';
import { UnsupportedSchemaError } from './persistence/migrations';

/** Small use-case boundary: validate before touching persistence; failures carry
 * stable codes. Diagnostics are reported only on the privileged side. */
export class ReaderService {
  private repository?: ReaderRepository;
  private failure?: 'STORAGE_UNAVAILABLE' | 'UNSUPPORTED_SCHEMA';
  constructor(private readonly open: () => ReaderRepository, private readonly languages: readonly string[],
    private readonly diagnose: (error: unknown) => void = console.error) {
    this.initializeStorage();
  }

  /** Reuse the same safe open/demo-initialization path on recoverable bootstrap
   * retries. A successful repository is retained; unsupported schemas stay closed. */
  private initializeStorage(): void {
    try {
      this.repository = this.open();
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
  dispatch(operation: ReaderOperation, args: readonly unknown[]): Result<ReaderState | readonly Comment[] | Preferences>;
  dispatch(operation: ReaderOperation, args: readonly unknown[]): Result<ReaderState | readonly Comment[] | Preferences> {
    if ((operation === 'bootstrap' && args.length !== 0)
      || (operation === 'toggleSeen' && (args.length !== 1 || !isToggleSeenRequest(args[0])))
      || (operation === 'updatePreferences' && (args.length !== 1 || !isPreferenceChange(args[0])))) {
      return { ok: false, error: { code: 'INVALID_REQUEST' } };
    }
    if (operation === 'bootstrap' && !this.repository && this.failure === 'STORAGE_UNAVAILABLE') this.initializeStorage();
    if (!this.repository) return { ok: false, error: { code: this.failure ?? 'STORAGE_UNAVAILABLE' } };
    try {
      let value: ReaderState | readonly Comment[] | Preferences;
      if (operation === 'bootstrap') value = this.repository.bootstrap(this.languages);
      else if (operation === 'toggleSeen' && isToggleSeenRequest(args[0])) value = this.repository.toggleSeen(args[0]);
      else if (operation === 'updatePreferences' && isPreferenceChange(args[0])) value = this.repository.updatePreferences(args[0], this.languages);
      else return { ok: false, error: { code: 'INVALID_REQUEST' } };
      return { ok: true, value };
    } catch (error) {
      this.diagnose(error);
      return { ok: false, error: { code: error instanceof MissingCommentError ? 'NOT_FOUND' : 'STORAGE_UNAVAILABLE' } };
    }
  }
  close(): void { this.repository?.close(); }
}
