import { isSaveDiscussionViewRequest } from '../domain/discussion-view';
import { isSetDiscussionCollapseRequest } from '../domain/discussion-collapse';
import type { SaveDiscussionViewRequest } from '../domain/discussion-view';
import type { SetDiscussionCollapseRequest } from '../domain/discussion-collapse';
import { isToggleSeenRequest, isBulkSeenRequest, isUndoSeenRequest, isPreferenceChange } from './reader-api';
import type { Result, ToggleSeenRequest, PreferenceChange, UndoSeenRequest } from './reader-api';
import type { BulkSeenRequest } from '../domain/seen-operation';
import { isSharedStamp } from './reader-sync';
import type { SharedStamp } from './reader-sync';

export const profileChannels = { event: 'reader:profile-event', stage: 'reader:profile-stage', submit: 'reader:profile-submit', plan: 'reader:profile-plan',
  command: 'reader:profile-drain', ack: 'reader:profile-ack', refuse: 'reader:profile-refuse', resume: 'reader:profile-resume', current: 'reader:profile-current' } as const;
export type ProfileKind = 'backup' | 'restore' | 'close' | 'reload' | 'quit';
export type ProfilePhase = 'IDLE' | 'PREPARING' | 'DRAINING' | 'QUIESCENT' | 'EXECUTING' | 'RELEASED' | 'RESTARTING';
/** Queued mutations register immutable main-owned tickets before preparation.
 * Deferred reading intent is captured separately as bounded final checkpoints. */
export type PendingMutation = { readonly kind: 'toggleSeen'; readonly request: ToggleSeenRequest }
  | { readonly kind: 'bulkSeen'; readonly request: BulkSeenRequest }
  | { readonly kind: 'undoSeen'; readonly request: UndoSeenRequest }
  | { readonly kind: 'updatePreferences'; readonly request: PreferenceChange };
/** One-use reservation for an immutable queued mutation. Main additionally binds
 * it to the captured caller context; no renderer identity field grants authority. */
export interface MutationTicket { readonly ticket: string; readonly profileEpoch: string }
export type DrainCommand = { readonly kind: 'view'; readonly request: SaveDiscussionViewRequest }
  | { readonly kind: 'collapse'; readonly request: SetDiscussionCollapseRequest }
  | (PendingMutation & { readonly ticket: MutationTicket });
/** Lifecycle status with a reconciliation watermark, never a content-commit ACK. */
export interface ProfileEvent { readonly operationId: string; readonly profileEpoch: string; readonly kind: ProfileKind;
  readonly phase: Exclude<ProfilePhase, 'IDLE'>; readonly stamp: SharedStamp; readonly failed: boolean }
export interface DrainIdentity { readonly operationId: string; readonly profileEpoch: string }
/** Main-issued capability for exactly count sealed commands, sequenced from zero.
 * Operation phase and current captured document are rechecked on every command. */
export interface DrainGrant extends DrainIdentity { readonly lease: string; readonly count: number }
/** This separate, fixed protocol never accepts a caller/window identity. */
export interface ProfileLifecycleApi {
  /** Preload-local settlement of submitted operations, excluding acquisition and
   * the requesting profile operation so preparation cannot wait on itself. */
  settleAccepted(): Promise<boolean>;
  stage(command: PendingMutation): Promise<Result<MutationTicket>>;
  submit(ticket: MutationTicket): Promise<Result<unknown>>;
  onEvent(listener: (event: ProfileEvent) => void): () => void;
  current(): Promise<Result<ProfileEvent | null>>;
  plan(identity: DrainIdentity, commands: readonly DrainCommand[]): Promise<Result<DrainGrant>>;
  command(grant: DrainGrant, sequence: number, command: DrainCommand): Promise<Result<unknown>>;
  ack(grant: DrainGrant, succeeded: boolean): Promise<Result<null>>;
  refuse(identity: DrainIdentity): Promise<Result<null>>;
  resume(identity: DrainIdentity): Promise<Result<null>>;
}
export function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
export function opaque(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value); }
export function isDrainIdentity(value: unknown): value is DrainIdentity {
  return exact(value, ['operationId', 'profileEpoch']) && opaque(value.operationId) && opaque(value.profileEpoch);
}
export function isDrainGrant(value: unknown): value is DrainGrant {
  return exact(value, ['operationId', 'profileEpoch', 'lease', 'count']) && opaque(value.operationId) && opaque(value.profileEpoch)
    && opaque(value.lease) && Number.isSafeInteger(value.count) && Number(value.count) >= 0 && Number(value.count) <= 4096;
}
export function isDrainCommand(value: unknown): value is DrainCommand {
  return exact(value, ['kind', 'request']) && (value.kind === 'view' ? isSaveDiscussionViewRequest(value.request)
    : value.kind === 'collapse' && isSetDiscussionCollapseRequest(value.request))
    || exact(value, ['kind', 'request', 'ticket']) && isMutationTicket(value.ticket) && isPendingMutation({ kind: value.kind, request: value.request });
}
export function isPendingMutation(value: unknown): value is PendingMutation {
  return exact(value, ['kind', 'request']) && (value.kind === 'toggleSeen' ? isToggleSeenRequest(value.request) : value.kind === 'bulkSeen' ? isBulkSeenRequest(value.request)
    : value.kind === 'undoSeen' ? isUndoSeenRequest(value.request) : value.kind === 'updatePreferences' && isPreferenceChange(value.request));
}
export function isMutationTicket(value: unknown): value is MutationTicket {
  return exact(value, ['ticket', 'profileEpoch']) && opaque(value.ticket) && opaque(value.profileEpoch);
}
export function isProfileEvent(value: unknown): value is ProfileEvent {
  return exact(value, ['operationId', 'profileEpoch', 'kind', 'phase', 'stamp', 'failed'])
    && opaque(value.operationId) && opaque(value.profileEpoch) && isSharedStamp(value.stamp) && value.stamp.profileEpoch === value.profileEpoch
    && ['backup', 'restore', 'close', 'reload', 'quit'].includes(String(value.kind))
    && ['PREPARING', 'DRAINING', 'QUIESCENT', 'EXECUTING', 'RELEASED', 'RESTARTING'].includes(String(value.phase)) && typeof value.failed === 'boolean';
}
