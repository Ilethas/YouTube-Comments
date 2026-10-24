import type { AcquisitionStage, CommentProgress } from './acquisition';
import { isCommentProgress, isCancelAcquisitionRequest } from './acquisition';
import type { AcquireRequest, RefreshRequest, Result } from './reader-api';

export type DownloadState = 'queued' | AcquisitionStage | 'completed' | 'failed' | 'cancelled';
/** Session-only, safe projection. No extractor output or executable information. */
export interface DownloadJob {
  readonly operationId: string;
  readonly sourceKind: 'youtube-video' | 'youtube-community-post';
  readonly sourceId: string;
  readonly kind: 'acquire' | 'refresh';
  readonly itemId?: string;
  readonly label: string;
  readonly state: DownloadState;
  readonly createdAt: number;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly cancellable: boolean;
  readonly comments?: CommentProgress;
  readonly failure?: 'HELPER_UNAVAILABLE' | 'ACQUISITION_FAILED' | 'STORAGE_UNAVAILABLE';
  readonly coverage?: 'complete' | 'partial' | 'unknown';
}
export interface DownloadsSnapshot {
  readonly profileEpoch: string;
  readonly revision: number;
  readonly jobs: readonly DownloadJob[];
}
export interface DownloadSubmission { readonly job: DownloadJob; readonly reused: boolean }
export type SubmitDownloadRequest = { readonly kind: 'acquire'; readonly url: AcquireRequest['url'] }
  | { readonly kind: 'refresh'; readonly itemId: RefreshRequest['itemId'] };
export interface DownloadsApi {
  submit(request: SubmitDownloadRequest): Promise<Result<DownloadSubmission>>;
  current(): Promise<Result<DownloadsSnapshot>>;
  onChanged(listener: (snapshot: DownloadsSnapshot) => void): () => void;
  cancel(request: { readonly operationId: string }): Promise<Result<null>>;
  retry(request: { readonly operationId: string }): Promise<Result<DownloadSubmission>>;
}
export const downloadsChangedChannel = 'reader:downloads-changed';
export const isDownloadIdentity = isCancelAcquisitionRequest;
export function downloadActive(job: DownloadJob): boolean { return !['queued', 'completed', 'failed', 'cancelled'].includes(job.state); }
export function downloadPending(job: DownloadJob): boolean { return job.state === 'queued' || downloadActive(job); }
export function isSubmitDownloadRequest(value: unknown): value is SubmitDownloadRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && Object.hasOwn(v, 'kind') && (v.kind === 'acquire'
    ? Object.hasOwn(v, 'url') && typeof v.url === 'string' && v.url.length > 0 && v.url.length <= 2048
    : v.kind === 'refresh' && Object.hasOwn(v, 'itemId') && typeof v.itemId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(v.itemId));
}
const id = (v: unknown) => typeof v === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(v);
const timestamp = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
export function isDownloadsSnapshot(value: unknown): value is DownloadsSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  if (Object.keys(v).length !== 3 || !['profileEpoch', 'revision', 'jobs'].every(k => Object.hasOwn(v, k))
    || !id(v.profileEpoch) || !timestamp(v.revision) || !Array.isArray(v.jobs) || v.jobs.length > 160) return false;
  const ids = new Set<string>();
  return v.jobs.every((job: unknown) => {
    if (!job || typeof job !== 'object' || Array.isArray(job)) return false;
    const j = job as Record<string, unknown>;
    const required = ['operationId', 'sourceKind', 'sourceId', 'kind', 'label', 'state', 'createdAt', 'cancellable'];
    const optional = ['itemId', 'startedAt', 'completedAt', 'comments', 'failure', 'coverage'];
    if (!required.every(k => Object.hasOwn(j, k)) || Object.keys(j).some(k => !required.includes(k) && !optional.includes(k))
      || !id(j.operationId) || ids.has(j.operationId as string) || !id(j.sourceId) || (Object.hasOwn(j, 'itemId') && !id(j.itemId))
      || !['youtube-video', 'youtube-community-post'].includes(j.sourceKind as string) || !['acquire', 'refresh'].includes(j.kind as string)
      || typeof j.label !== 'string' || j.label.length > 180 || [...j.label].some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159)
      || !['queued', 'checking-helper', 'preparing', 'fetching', 'processing', 'saving', 'completed', 'failed', 'cancelled'].includes(j.state as string)
      || !timestamp(j.createdAt) || typeof j.cancellable !== 'boolean'
      || ['startedAt', 'completedAt'].some(k => Object.hasOwn(j, k) && !timestamp(j[k]))
      || (Object.hasOwn(j, 'comments') && !isCommentProgress(j.comments))
      || (Object.hasOwn(j, 'failure') && !['HELPER_UNAVAILABLE', 'ACQUISITION_FAILED', 'STORAGE_UNAVAILABLE'].includes(j.failure as string))
      || (Object.hasOwn(j, 'coverage') && !['complete', 'partial', 'unknown'].includes(j.coverage as string))
      || (['saving', 'completed', 'failed', 'cancelled'].includes(j.state as string) && j.cancellable)) return false;
    ids.add(j.operationId as string); return true;
  });
}
