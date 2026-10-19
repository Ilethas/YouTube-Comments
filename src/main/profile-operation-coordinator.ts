import { randomUUID } from 'node:crypto';
import type { ReaderCallerContext } from './caller-context';
import type { Result } from '../shared/reader-api';
import type { SharedStamp } from '../shared/reader-sync';
import { isDrainCommand, isDrainGrant, isDrainIdentity, isPendingMutation, isMutationTicket } from '../shared/profile-operation';
import type { PendingMutation, MutationTicket, DrainCommand, DrainGrant, DrainIdentity, ProfileEvent, ProfileKind, ProfilePhase } from '../shared/profile-operation';

interface Participant {
  readonly caller: ReaderCallerContext;
  commands?: readonly DrainCommand[];
  grant?: DrainGrant;
  sequence: number;
  acknowledged: boolean;
  resumed: boolean;
  failed: boolean;
}
interface Operation {
  readonly id: string;
  readonly epoch: string;
  readonly kind: ProfileKind;
  readonly participants: Participant[];
  phase: Exclude<ProfilePhase, 'IDLE'>;
  failed: boolean;
  appOwned: boolean;
  resolve: () => void;
  reject: (error: Error) => void;
  readonly drained: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
}
const denied = (): Result<never> => ({ ok: false, error: { code: 'FORBIDDEN' } });

/** One narrowly scoped profile barrier. Main captures context objects, seals exact
 * checkpoint manifests, issues bounded one-use sequence leases, and owns every
 * transition. A timeout fails preparation; it can never substitute for an ACK. */
export class ProfileOperationCoordinator {
  private operation?: Operation;
  private readonly releaseWaiters = new Set<() => void>();
  private readonly tickets = new Map<string, { caller: ReaderCallerContext; command: PendingMutation; epoch: string; bytes: number }>();
  private intentionalQueue: Promise<unknown> = Promise.resolve();
  constructor(private readonly participants: () => readonly ReaderCallerContext[],
    private readonly send: (caller: ReaderCallerContext, event: ProfileEvent) => void,
    private readonly stamp: () => SharedStamp,
    private readonly execute: (caller: ReaderCallerContext, command: DrainCommand) => Result<unknown>,
    private readonly deadlineMs = 15000,
    private readonly checkpointAllowed: (command: DrainCommand, caller: ReaderCallerContext) => boolean = () => true) {}

  /** Serialize only main's intentional Close/Reload/Quit requests. Profile
   * commands themselves still reject concurrent requests instead of queuing. */
  scheduleIntentional(task: () => Promise<void>): Promise<void> {
    const next = this.intentionalQueue.then(task); this.intentionalQueue = next.catch(() => undefined); return next;
  }

  get phase(): ProfilePhase { return this.operation?.phase ?? 'IDLE'; }
  get busy(): boolean { return !!this.operation && this.operation.phase !== 'RELEASED'; }
  /** Reserve queued user intent while ordinary input is still allowed. A frozen
   * participant cannot create tickets, even using the lifecycle IPC channels. */
  stage(caller: ReaderCallerContext, command: unknown): Result<MutationTicket> {
    if (!caller.isCurrent() || this.blocks(caller) || !isPendingMutation(command)) return denied();
    const existing = [...this.tickets.values()].filter(t => t.caller === caller), bytes = JSON.stringify(command).length;
    if (existing.length >= 4096 || existing.reduce((sum, t) => sum + t.bytes, bytes) > 8 * 1024 * 1024) return denied();
    const ticket = randomUUID(), epoch = this.stamp().profileEpoch;
    this.tickets.set(ticket, { caller, command: structuredClone(command), epoch, bytes });
    return { ok: true, value: { ticket, profileEpoch: epoch } };
  }
  private reserved(caller: ReaderCallerContext, ticket: MutationTicket, command?: PendingMutation): boolean {
    const stored = this.tickets.get(ticket.ticket);
    return !!stored && stored.caller === caller && caller.isCurrent() && ticket.profileEpoch === stored.epoch && stored.epoch === this.stamp().profileEpoch
      && (!command || JSON.stringify(stored.command) === JSON.stringify(command));
  }
  submit(caller: ReaderCallerContext, ticket: unknown): Result<unknown> {
    if (!isMutationTicket(ticket) || !this.reserved(caller, ticket)) return denied();
    if (this.blocks(caller)) return { ok: false, error: { code: 'DATA_BUSY' } };
    const stored = this.tickets.get(ticket.ticket);
    if (!stored) return denied();
    this.tickets.delete(ticket.ticket);
    return this.execute(caller, { ...stored.command, ticket });
  }
  /** Read-only M2 snapshots stay available until storage actually goes offline. */
  blocks(caller?: ReaderCallerContext): boolean {
    const op = this.operation;
    if (!op) return false;
    if (op.phase !== 'RELEASED') return true;
    return !!caller && op.participants.some(p => p.caller === caller && !p.resumed);
  }
  current(): ProfileEvent | null {
    const op = this.operation;
    return op ? { operationId: op.id, profileEpoch: op.epoch, kind: op.kind, phase: op.phase, stamp: this.stamp(), failed: op.failed } : null;
  }
  private publish(): void {
    const event = this.current(); if (!event) return;
    // Include new incarnations: they must stay inert until release/reconciliation.
    for (const caller of this.participants()) { try { this.send(caller, event); } catch { /* Loss is handled separately. */ } }
  }
  private transition(next: Operation['phase']): void {
    const op = this.operation; if (!op) throw new Error('Missing profile operation');
    const legal: Record<Operation['phase'], readonly Operation['phase'][]> = {
      PREPARING: ['DRAINING', 'RELEASED'], DRAINING: ['QUIESCENT', 'RELEASED'], QUIESCENT: ['EXECUTING', 'RELEASED'],
      EXECUTING: ['RELEASED', 'RESTARTING'], RELEASED: [], RESTARTING: [],
    };
    if (!legal[op.phase].includes(next)) throw new Error('Illegal profile transition');
    op.phase = next; this.publish();
  }
  onPreparing?: () => void;
  /** Starts synchronously: ordinary mutations stop before the first notification. */
  begin(kind: ProfileKind): Promise<void> {
    if (this.busy) return Promise.reject(new Error('Profile busy'));
    // A live participant that has not reconciled cannot enter a fresh drain.
    if (this.operation?.participants.some(p => p.caller.isCurrent() && !p.resumed)) return Promise.reject(new Error('Release pending'));
    let resolve!: () => void, reject!: (error: Error) => void;
    const drained = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    this.onPreparing?.();
    const op: Operation = { id: randomUUID(), epoch: this.stamp().profileEpoch, kind, phase: 'PREPARING', failed: false, appOwned: false,
      participants: this.participants().map(caller => ({ caller, sequence: 0, acknowledged: false, resumed: false, failed: false })), resolve, reject, drained };
    this.operation = op;
    op.timer = setTimeout(() => this.fail(op), this.deadlineMs);
    this.publish(); this.transition('DRAINING');
    this.complete(); return drained;
  }
  private participant(caller: ReaderCallerContext, identity: DrainIdentity): Participant | undefined {
    const op = this.operation;
    if (!op || !caller.isCurrent() || op.id !== identity.operationId || op.epoch !== identity.profileEpoch || this.stamp().profileEpoch !== op.epoch) return;
    return op.participants.find(p => p.caller === caller);
  }
  plan(caller: ReaderCallerContext, identity: unknown, commands: unknown): Result<DrainGrant> {
    if (!isDrainIdentity(identity) || !Array.isArray(commands) || commands.length > 4096 || !commands.every(isDrainCommand)) return denied();
    const participant = this.participant(caller, identity), op = this.operation;
    if (!participant || !op || op.phase !== 'DRAINING' || participant.commands || JSON.stringify(commands).length > 8 * 1024 * 1024) return denied();
    const used = new Set<string>(), views = new Set<string>(), collapseDefaults = new Map<string, boolean>(), collapseOverrides = new Set<string>();
    for (const command of commands) {
      if (!this.checkpointAllowed(command, caller)) return denied();
      if (command.kind === 'view') {
        if (views.has(command.request.viewId)) return denied(); views.add(command.request.viewId);
      }
      if (command.kind === 'collapse') {
        const request = command.request;
        if (request.kind === 'all') {
          if (collapseDefaults.has(request.viewId)) return denied(); collapseDefaults.set(request.viewId, request.collapsed);
        } else {
          if (!collapseDefaults.has(request.viewId) || collapseDefaults.get(request.viewId) === request.collapsed || collapseOverrides.has(request.viewId)) return denied();
          collapseOverrides.add(request.viewId);
        }
      }
    }
    for (const command of commands) if ('ticket' in command) {
      if (used.has(command.ticket.ticket) || !this.reserved(caller, command.ticket, { kind: command.kind, request: command.request } as PendingMutation)) return denied();
      used.add(command.ticket.ticket);
    }
    if ([...this.tickets].some(([key, ticket]) => ticket.caller === caller && !used.has(key))) return denied();
    // Seal an independent copy; neither renderer nor trusted callers can mutate it.
    participant.commands = structuredClone(commands);
    participant.grant = { ...identity, lease: randomUUID(), count: commands.length };
    return { ok: true, value: participant.grant };
  }
  command(caller: ReaderCallerContext, grant: unknown, sequence: unknown, command: unknown): Result<unknown> {
    if (!isDrainGrant(grant) || !isDrainCommand(command) || !Number.isSafeInteger(sequence)) return denied();
    const p = this.participant(caller, grant), op = this.operation;
    if (!p || !op || op.phase !== 'DRAINING' || p.acknowledged || p.failed || !p.grant || JSON.stringify(p.grant) !== JSON.stringify(grant)
      || sequence !== p.sequence || p.sequence >= grant.count || JSON.stringify(p.commands?.[p.sequence]) !== JSON.stringify(command)) return denied();
    const result = this.execute(caller, command);
    if ('ticket' in command) this.tickets.delete(command.ticket.ticket);
    if (result.ok) p.sequence++; else p.failed = true;
    return result;
  }
  ack(caller: ReaderCallerContext, grant: unknown, succeeded: unknown): Result<null> {
    if (!isDrainGrant(grant) || typeof succeeded !== 'boolean') return denied();
    const p = this.participant(caller, grant), op = this.operation;
    if (!p || !op || op.phase !== 'DRAINING' || p.acknowledged || !p.grant || JSON.stringify(p.grant) !== JSON.stringify(grant)) return denied();
    if (!succeeded || p.failed || p.sequence !== grant.count || [...this.tickets.values()].some(ticket => ticket.caller === caller)) {
      this.fail(op); return { ok: true, value: null };
    }
    p.acknowledged = true; this.complete(); return { ok: true, value: null };
  }
  refuse(caller: ReaderCallerContext, identity: unknown): Result<null> {
    if (!isDrainIdentity(identity) || !this.participant(caller, identity) || this.phase !== 'DRAINING') return denied();
    if (this.operation) this.fail(this.operation); return { ok: true, value: null };
  }
  private complete(): void {
    const op = this.operation;
    if (op?.phase === 'DRAINING' && op.participants.every(p => p.acknowledged && p.caller.isCurrent())) {
      clearTimeout(op.timer); this.transition('QUIESCENT'); op.resolve();
    }
  }
  /** Explicit failure injection also drives deterministic deadline tests. */
  expire(): void { if (this.operation) this.fail(this.operation); }
  private fail(op: Operation): void {
    if (this.operation !== op || op.phase === 'RELEASED' || op.phase === 'RESTARTING' || op.appOwned) return;
    op.failed = true; op.reject(new Error('Profile drain failed')); this.release(true);
  }
  lost(caller: ReaderCallerContext): void {
    for (const [key, ticket] of this.tickets) if (ticket.caller === caller) this.tickets.delete(key);
    const op = this.operation;
    if (op?.participants.some(p => p.caller === caller)) this.fail(op);
    this.wakeReleased();
  }
  cancelPreparation(): void { if (this.operation) this.fail(this.operation); }
  private wakeReleased(): void {
    if (this.busy || this.operation?.participants.some(p => p.caller.isCurrent() && !p.resumed)) return;
    for (const resolve of this.releaseWaiters) resolve(); this.releaseWaiters.clear();
  }
  released(): Promise<void> {
    if (!this.busy && !this.operation?.participants.some(p => p.caller.isCurrent() && !p.resumed)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const done = () => { clearTimeout(timer); resolve(); };
      const timer = setTimeout(() => { this.releaseWaiters.delete(done); reject(new Error('Participant reconciliation unavailable')); }, this.deadlineMs);
      this.releaseWaiters.add(done);
    });
  }
  executePhase(): void { this.transition('EXECUTING'); }
  /** Destination accepted / affirmative restore confirmation commits app ownership. */
  accept(): void {
    if (this.operation?.phase !== 'EXECUTING') throw new Error('Preflight no longer current');
    this.operation.appOwned = true;
  }
  restarting(): void { this.transition('RESTARTING'); }
  release(failed = false, expectedId?: string): void {
    const op = this.operation;
    if (!op || expectedId && expectedId !== op.id || op.phase === 'RELEASED' || op.phase === 'RESTARTING') return;
    clearTimeout(op.timer); op.failed ||= failed;
    // Capabilities are phase-revoked before publishing release.
    this.transition('RELEASED');
    this.wakeReleased();
  }
  resume(caller: ReaderCallerContext, identity: unknown): Result<null> {
    if (!isDrainIdentity(identity) || !caller.isCurrent()) return denied();
    const op = this.operation;
    if (!op || op.phase !== 'RELEASED' || identity.operationId !== op.id || identity.profileEpoch !== op.epoch) return denied();
    const p = op.participants.find(p => p.caller === caller); if (p) p.resumed = true;
    this.wakeReleased();
    return { ok: true, value: null };
  }
}
