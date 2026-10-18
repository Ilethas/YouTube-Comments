import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { RendererProfileLifecycle } from './profile-lifecycle';
import type { ProfileEvent, ProfileLifecycleApi } from '../shared/profile-operation';
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function setup() {
  let receive!: (event: ProfileEvent) => void;
  const event: ProfileEvent = { operationId: randomUUID(), profileEpoch: randomUUID(), phase: 'DRAINING', kind: 'backup', failed: false,
    stamp: { profileEpoch: '', commitRevision: 5 } }; Object.assign(event, { stamp: { ...event.stamp, profileEpoch: event.profileEpoch } });
  const api: ProfileLifecycleApi = {
    onEvent: listener => { receive = listener; return () => undefined; }, current: async () => ({ ok: true, value: null }), settleAccepted: vi.fn(async () => true),
    stage: vi.fn(async () => ({ ok: true as const, value: { ticket: randomUUID(), profileEpoch: event.profileEpoch } })),
    submit: vi.fn(async () => ({ ok: true as const, value: null })),
    refuse: vi.fn(async () => ({ ok: true as const, value: null })),
    plan: vi.fn(async identity => ({ ok: true as const, value: { ...identity, lease: randomUUID(), count: 0 } })),
    command: vi.fn(async () => ({ ok: true as const, value: null })), ack: vi.fn(async () => ({ ok: true as const, value: null })), resume: vi.fn(async () => ({ ok: true as const, value: null })),
  };
  const hooks = { freeze: vi.fn(), checkpoints: vi.fn(async () => []), settled: vi.fn(async () => true), reconcile: vi.fn(async (): Promise<void> => undefined), release: vi.fn(), releaseFailure: vi.fn() };
  const controller = new RendererProfileLifecycle(api, hooks); controller.start();
  return { api, hooks, controller, event, send: (e = event) => receive(e) };
}
it('freezes synchronously, waits accepted saves, and sends exactly one drain acknowledgement', async () => {
  const s = setup(), pending = defer(); vi.mocked(s.api.settleAccepted).mockImplementationOnce(async () => { await pending.promise; return true; });
  s.send(); expect(s.hooks.freeze).toHaveBeenCalledTimes(1); expect(s.api.plan).not.toHaveBeenCalled();
  s.send(); pending.resolve(); await vi.waitFor(() => expect(s.api.ack).toHaveBeenCalledTimes(1));
  expect(s.api.plan).toHaveBeenCalledTimes(1); expect(s.hooks.release).not.toHaveBeenCalled(); s.controller.stop();
});
it('a failed accepted write reports failure rather than claiming to be drained', async () => {
  const s = setup(); vi.mocked(s.hooks.settled).mockResolvedValueOnce(false); s.send();
  await vi.waitFor(() => expect(s.api.refuse).toHaveBeenCalledWith({ operationId: s.event.operationId, profileEpoch: s.event.profileEpoch }));
  expect(s.api.ack).not.toHaveBeenCalled(); s.controller.stop();
});
it('release reconciles notifications/watermarks before resume and user input', async () => {
  const s = setup(), reconcile = defer(); s.hooks.reconcile.mockImplementationOnce(() => reconcile.promise);
  s.send(); s.send({ ...s.event, phase: 'RELEASED' });
  expect(s.api.resume).not.toHaveBeenCalled(); expect(s.hooks.release).not.toHaveBeenCalled();
  reconcile.resolve(); await vi.waitFor(() => expect(s.hooks.release).toHaveBeenCalledWith(false));
  expect(s.api.resume).toHaveBeenCalledTimes(1); s.controller.stop();
});
it('a stuck preparation can release; its late callbacks cannot submit old drain commands', async () => {
  const s = setup(), stalled = defer(); s.hooks.checkpoints.mockImplementationOnce(async () => { await stalled.promise; return []; });
  s.send(); s.send({ ...s.event, phase: 'RELEASED', failed: true });
  await vi.waitFor(() => expect(s.hooks.release).toHaveBeenCalledWith(true)); stalled.resolve();
  await Promise.resolve(); await Promise.resolve(); expect(s.api.plan).not.toHaveBeenCalled(); s.controller.stop();
});
it('failed reconciliation keeps input frozen until an explicit successful retry', async () => {
  const s = setup(); s.hooks.reconcile.mockRejectedValueOnce(new Error('Snapshot unavailable'));
  s.send({ ...s.event, phase: 'RELEASED' }); await vi.waitFor(() => expect(s.hooks.releaseFailure).toHaveBeenCalled());
  expect(s.api.resume).not.toHaveBeenCalled(); expect(s.hooks.release).not.toHaveBeenCalled();
  s.controller.retryRelease(); await vi.waitFor(() => expect(s.hooks.release).toHaveBeenCalledWith(false)); s.controller.stop();
});
