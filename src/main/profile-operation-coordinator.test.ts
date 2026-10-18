import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { ProfileOperationCoordinator } from './profile-operation-coordinator';
import type { ReaderCallerContext } from './caller-context';
import type { DrainCommand, DrainGrant, ProfileEvent } from '../shared/profile-operation';
import { defaultQuery } from '../domain/discussion-query';

afterEach(() => vi.useRealTimers());
const command: DrainCommand = { kind: 'view', request: { itemId: 'video-demo', draft: defaultQuery, applied: defaultQuery,
  sort: 'newest', selected: null, anchor: { commentId: null, offset: 0 } } };
function setup() {
  const stamp = { profileEpoch: randomUUID(), commitRevision: 0 };
  const alive = [true, true];
  const callers: ReaderCallerContext[] = alive.map((_, index) => Object.freeze({ windowId: randomUUID(), rendererLease: randomUUID(), isCurrent: () => alive[index] }));
  const events: ProfileEvent[] = [];
  const execute = vi.fn(() => { stamp.commitRevision++; return { ok: true as const, value: null }; });
  const coordinator = new ProfileOperationCoordinator(() => callers.filter(c => c.isCurrent()), (_caller, event) => events.push(event), () => ({ ...stamp }), execute);
  const identity = () => { const event = coordinator.current(); if (!event) throw new Error('No operation'); return { operationId: event.operationId, profileEpoch: event.profileEpoch }; };
  const plan = (index: number, commands: DrainCommand[] = [command]) => {
    const result = coordinator.plan(callers[index], identity(), commands); if (!result.ok) throw new Error('Plan rejected'); return result.value;
  };
  const finish = (index: number, grant: DrainGrant, commands: DrainCommand[] = [command]) => {
    commands.forEach((value, sequence) => expect(coordinator.command(callers[index], grant, sequence, value).ok).toBe(true));
    return coordinator.ack(callers[index], grant, true);
  };
  return { coordinator, stamp, alive, callers, events, execute, identity, plan, finish };
}
it('enrolls two contexts synchronously, drains in either order and revokes leases before execution/release', async () => {
  const s = setup(), pending = s.coordinator.begin('backup');
  expect(s.coordinator.blocks(s.callers[0])).toBe(true);
  expect(s.events.map(e => e.phase)).toEqual(['PREPARING', 'PREPARING', 'DRAINING', 'DRAINING']);
  const a = s.plan(0), b = s.plan(1);
  s.finish(1, b); expect(s.coordinator.phase).toBe('DRAINING');
  s.finish(0, a); await pending; expect(s.coordinator.phase).toBe('QUIESCENT');
  expect(s.coordinator.command(s.callers[0], a, 0, command).ok).toBe(false);
  s.coordinator.executePhase(); s.coordinator.accept(); s.coordinator.release();
  expect(s.coordinator.blocks(s.callers[0])).toBe(true);
  expect(s.coordinator.resume(s.callers[0], s.identity()).ok).toBe(true);
  expect(s.coordinator.blocks(s.callers[0])).toBe(false); expect(s.coordinator.blocks(s.callers[1])).toBe(true);
  s.coordinator.resume(s.callers[1], s.identity()); await s.coordinator.released();
  expect(s.stamp.commitRevision).toBe(2);
});
it.each(['copied-context', 'wrong-window', 'wrong-lease', 'wrong-epoch', 'wrong-operation', 'wrong-capability', 'wrong-count', 'extra-field', 'skipped-sequence', 'changed-payload', 'unauthorized-kind'])(
  'rejects %s without executing any drain command', async attack => {
    const s = setup(), pending = s.coordinator.begin('backup'); const failed = expect(pending).rejects.toThrow();
    const grant = s.plan(0);
    let caller = s.callers[0], altered: unknown = grant, sequence = 0, value: unknown = command;
    if (attack === 'copied-context') caller = { ...caller };
    if (attack === 'wrong-window') caller = s.callers[1];
    if (attack === 'wrong-lease') caller = { ...caller, rendererLease: randomUUID() };
    if (attack === 'wrong-epoch') altered = { ...grant, profileEpoch: randomUUID() };
    if (attack === 'wrong-operation') altered = { ...grant, operationId: randomUUID() };
    if (attack === 'wrong-capability') altered = { ...grant, lease: randomUUID() };
    if (attack === 'wrong-count') altered = { ...grant, count: 2 };
    if (attack === 'extra-field') altered = { ...grant, windowId: caller.windowId };
    if (attack === 'skipped-sequence') sequence = 1;
    if (attack === 'changed-payload') value = { ...command, request: { ...command.request, sort: 'oldest' } };
    if (attack === 'unauthorized-kind') value = { kind: 'toggleSeen', request: {} };
    expect(s.coordinator.command(caller, altered, sequence, value).ok).toBe(false);
    expect(s.execute).not.toHaveBeenCalled(); s.coordinator.expire(); await failed;
  });
it('rejects forged, early and replayed acknowledgments and seals the command manifest', async () => {
  const s = setup(), pending = s.coordinator.begin('backup');
  const manifest = [structuredClone(command)], grant = s.plan(0, manifest);
  manifest[0] = { ...command, request: { ...command.request, sort: 'oldest' } };
  expect(s.coordinator.command(s.callers[0], grant, 0, manifest[0]).ok).toBe(false);
  expect(s.coordinator.ack(s.callers[1], grant, true).ok).toBe(false);
  expect(s.coordinator.plan(s.callers[0], s.identity(), []).ok).toBe(false);
  s.finish(0, grant);
  expect(s.coordinator.ack(s.callers[0], grant, true).ok).toBe(false);
  expect(s.coordinator.command(s.callers[0], grant, 0, command).ok).toBe(false);
  s.finish(1, s.plan(1)); await pending; s.coordinator.release();
});
it('an ACK before all bounded sequences complete fails the operation', async () => {
  const s = setup(), pending = s.coordinator.begin('backup'), failed = expect(pending).rejects.toThrow();
  s.coordinator.ack(s.callers[0], s.plan(0), true); await failed; expect(s.coordinator.phase).toBe('RELEASED');
});
it.each(['close', 'reload', 'crash'])('participant %s fails preflight; a new incarnation cannot reuse its grant', async () => {
  const s = setup(), pending = s.coordinator.begin('restore'), failed = expect(pending).rejects.toThrow(); const grant = s.plan(0);
  s.alive[0] = false; s.coordinator.lost(s.callers[0]); await failed;
  expect(s.coordinator.phase).toBe('RELEASED'); expect(s.coordinator.current()?.failed).toBe(true);
  expect(s.coordinator.ack({ ...s.callers[0], rendererLease: randomUUID(), isCurrent: () => true }, grant, true).ok).toBe(false);
});
it('a live hang expires as failure, never quiescence, and retry waits for reconciliation', async () => {
  vi.useFakeTimers(); const s = setup(), pending = s.coordinator.begin('close'), failed = expect(pending).rejects.toThrow();
  s.finish(0, s.plan(0)); await vi.advanceTimersByTimeAsync(15000); await failed;
  expect(s.coordinator.phase).toBe('RELEASED'); await expect(s.coordinator.begin('close')).rejects.toThrow('Release pending');
  s.callers.forEach(c => s.coordinator.resume(c, s.identity()));
  const retry = s.coordinator.begin('close'); s.finish(0, s.plan(0, []), []); s.finish(1, s.plan(1, []), []); await retry;
  s.coordinator.release();
});
it('persisted-save failure prevents execution and keeps final sequence unacknowledged', async () => {
  const s = setup(); s.execute.mockImplementationOnce(() => ({ ok: false, error: { code: 'STORAGE_UNAVAILABLE' } }) as never);
  const pending = s.coordinator.begin('backup'), failed = expect(pending).rejects.toThrow(), grant = s.plan(0);
  expect(s.coordinator.command(s.callers[0], grant, 0, command).ok).toBe(false);
  s.coordinator.ack(s.callers[0], grant, true); await failed; expect(s.coordinator.phase).toBe('RELEASED');
});
it('confirmed restore ignores origin loss and terminal fencing rejects old epoch callbacks', async () => {
  const s = setup(), pending = s.coordinator.begin('restore'), grant = s.plan(0);
  s.finish(0, grant); s.finish(1, s.plan(1)); await pending;
  s.coordinator.executePhase(); s.coordinator.accept(); s.alive[0] = false; s.coordinator.lost(s.callers[0]);
  expect(s.coordinator.phase).toBe('EXECUTING'); s.coordinator.restarting(); s.coordinator.release();
  s.stamp.profileEpoch = randomUUID();
  expect(s.coordinator.phase).toBe('RESTARTING'); expect(s.coordinator.command(s.callers[1], grant, 0, command).ok).toBe(false);
  await expect(s.coordinator.begin('backup')).rejects.toThrow('Profile busy');
});
it('rejects concurrent operations and illegal state transitions', async () => {
  const s = setup(), pending = s.coordinator.begin('quit'), failed = expect(pending).rejects.toThrow();
  await expect(s.coordinator.begin('backup')).rejects.toThrow('Profile busy');
  expect(() => s.coordinator.executePhase()).toThrow('Illegal profile transition');
  s.coordinator.expire(); await failed;
});
it('registers queued intent before preparation; only its exact ticket can enter the sealed drain', async () => {
  const s = setup();
  const mutation = { kind: 'toggleSeen' as const, request: { itemId: 'video-demo', commentId: 'v3', subtree: false, seen: true } };
  const staged = s.coordinator.stage(s.callers[0], mutation); if (!staged.ok) throw new Error('Stage failed');
  const pending = s.coordinator.begin('backup');
  expect(s.coordinator.stage(s.callers[0], mutation).ok).toBe(false);
  expect(s.coordinator.submit(s.callers[0], staged.value)).toMatchObject({ error: { code: 'DATA_BUSY' } });
  expect(s.coordinator.plan(s.callers[0], s.identity(), []).ok).toBe(false);
  expect(s.coordinator.plan(s.callers[0], s.identity(), [{ ...mutation, ticket: { ...staged.value, ticket: randomUUID() } }]).ok).toBe(false);
  expect(s.coordinator.plan(s.callers[0], s.identity(), [{ ...mutation, request: { ...mutation.request, seen: false }, ticket: staged.value }]).ok).toBe(false);
  expect(s.coordinator.plan(s.callers[1], s.identity(), [{ ...mutation, ticket: staged.value }]).ok).toBe(false);
  const frozen: DrainCommand = { ...mutation, ticket: staged.value };
  s.finish(0, s.plan(0, [frozen]), [frozen]); s.finish(1, s.plan(1, []), []); await pending;
  s.coordinator.release(); s.callers.forEach(c => s.coordinator.resume(c, s.identity()));
  expect(s.coordinator.submit(s.callers[0], staged.value).ok).toBe(false);
  expect(s.execute).toHaveBeenCalledTimes(1);
});
it('normal ticket submission is one-use, lease-bound and epoch-bound', () => {
  const s = setup(), queued = { kind: 'updatePreferences' as const, request: { appearance: 'dark' as const } };
  const first = s.coordinator.stage(s.callers[0], queued); if (!first.ok) throw new Error('Stage failed');
  expect(s.coordinator.submit(s.callers[1], first.value).ok).toBe(false);
  expect(s.coordinator.submit({ ...s.callers[0] }, first.value).ok).toBe(false);
  expect(s.coordinator.submit(s.callers[0], first.value).ok).toBe(true);
  expect(s.coordinator.submit(s.callers[0], first.value).ok).toBe(false);
  const second = s.coordinator.stage(s.callers[0], queued); if (!second.ok) throw new Error('Stage failed');
  s.stamp.profileEpoch = randomUUID(); expect(s.coordinator.submit(s.callers[0], second.value).ok).toBe(false);
});
it('cannot invent unticketed mutations or duplicate checkpoint command budgets', async () => {
  const s = setup(), pending = s.coordinator.begin('backup'), failed = expect(pending).rejects.toThrow();
  expect(s.coordinator.plan(s.callers[0], s.identity(), [{ kind: 'updatePreferences', request: { appearance: 'dark' } }]).ok).toBe(false);
  expect(s.coordinator.plan(s.callers[0], s.identity(), [command, command]).ok).toBe(false);
  expect(s.coordinator.plan(s.callers[0], s.identity(), [{ kind: 'collapse', request: { itemId: 'video-demo', kind: 'comments', ids: ['v1'], collapsed: true } }]).ok).toBe(false);
  s.coordinator.refuse(s.callers[0], s.identity()); await failed;
});
