/** Safe application-owned notifications; never helper diagnostics or process identity. */
export type AcquisitionStage = 'checking-helper' | 'preparing' | 'fetching' | 'processing' | 'saving';
/** Immutable run identity/start; cancellable turns false before accepted ingest. */
export interface AcquisitionProgress {
  readonly operationId: string;
  readonly kind: 'acquire' | 'refresh';
  readonly sourceKind: 'youtube-video' | 'youtube-community-post';
  readonly itemId?: string;
  readonly stage: AcquisitionStage;
  readonly startedAt: number;
  readonly cancellable: boolean;
}
export type AcquisitionNotification = AcquisitionProgress | { readonly operationId: string; readonly settled: true };
export const acquisitionProgressChannel = 'reader:acquisition-progress';
/** Main-only monotonic interval measurements. Bootstrap is state construction,
 * not Electron serialization; values are diagnostic and never persisted. */
export interface AcquisitionTimings {
  readonly targetMs: number;
  readonly helperMs: number;
  readonly preparationMs: number;
  readonly fetchMs: number;
  readonly processingMs: number;
  readonly savingMs: number;
  readonly bootstrapMs: number;
  readonly totalMs: number;
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(value);
/** Cancellation grants only an exact active operation-ID intent. */
export function isCancelAcquisitionRequest(value: unknown): value is { operationId: string } {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 1
    && Object.hasOwn(value, 'operationId') && id((value as { operationId?: unknown }).operationId);
}
/** Exact shape validation strips the Electron event and rejects accidental privileged fields. */
export function isAcquisitionNotification(value: unknown): value is AcquisitionNotification {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (!id(v.operationId)) return false;
  if (v.settled === true) return Object.keys(v).length === 2 && Object.hasOwn(v, 'operationId') && Object.hasOwn(v, 'settled');
  const keys = ['operationId', 'kind', 'sourceKind', 'stage', 'startedAt', 'cancellable'];
  return Object.keys(v).length === keys.length + (Object.hasOwn(v, 'itemId') ? 1 : 0)
    && keys.every(key => Object.hasOwn(v, key)) && (!Object.hasOwn(v, 'itemId') || id(v.itemId))
    && (v.kind === 'acquire' || v.kind === 'refresh')
    && (v.sourceKind === 'youtube-video' || v.sourceKind === 'youtube-community-post')
    && ['checking-helper', 'preparing', 'fetching', 'processing', 'saving'].includes(v.stage as string)
    && typeof v.startedAt === 'number' && Number.isFinite(v.startedAt) && v.startedAt >= 0
    && typeof v.cancellable === 'boolean' && (v.stage !== 'saving' || !v.cancellable);
}
