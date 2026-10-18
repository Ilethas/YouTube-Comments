import { expect, it, vi } from 'vitest';
import { WindowCoordinator } from './window-coordinator';
import { windowFixture } from './testing/window-fixture';

vi.mock('electron', () => ({}));
const url = 'file:///app/index.html';
it('binds the persistent identity before authorization, keeps reload leases fresh and rejects a second live owner', () => {
  const coordinator = new WindowCoordinator(url, ''), a = windowFixture(), b = windowFixture();
  coordinator.setIdentityProvider(() => 'persisted-window');
  coordinator.register(a.window);
  expect(coordinator.resolveCaller(a.event())).toBeUndefined();
  a.commit(); const original = coordinator.resolveCaller(a.event());
  expect(original?.windowId).toBe('persisted-window');
  expect(() => coordinator.register(b.window)).toThrow('Persistent window already registered');
  expect(coordinator.resolveCaller(a.event())).toBe(original);
  a.reload();
  expect(coordinator.resolveCaller(a.event())?.windowId).toBe('persisted-window');
  expect(coordinator.resolveCaller(a.event())?.rendererLease).not.toBe(original?.rendererLease);
  expect(original?.isCurrent()).toBe(false);
});
it('requires registration and a trusted document commit; identities are opaque and contexts frozen', () => {
  const coordinator = new WindowCoordinator(url, '/trusted/preload.js'), a = windowFixture(), b = windowFixture();
  expect(coordinator.resolveCaller(a.event())).toBeUndefined();
  coordinator.register(a.window);
  expect(coordinator.resolveCaller(a.event())).toBeUndefined(); a.commit();
  const caller = coordinator.resolveCaller(a.event());
  expect(caller?.windowId).toMatch(/^[\da-f-]{36}$/);
  expect(caller?.rendererLease).toMatch(/^[\da-f-]{36}$/);
  expect(Object.isFrozen(caller)).toBe(true); expect(caller?.isCurrent()).toBe(true);
  expect(coordinator.originWindow(caller)).toBe(a.window);
  expect(coordinator.resolveCaller(b.event())).toBeUndefined();
  expect(coordinator.resolveCaller({ ...a.event(), senderFrame: b.event().senderFrame })).toBeUndefined();
  expect(coordinator.originWindow(caller && { ...caller })).toBeUndefined();
});

it('reload and registry replacement invalidate captured contexts and stale frames', () => {
  const coordinator = new WindowCoordinator(url, ''), a = windowFixture();
  coordinator.register(a.window); a.commit();
  const oldEvent = a.event(), first = coordinator.resolveCaller(oldEvent);
  a.reload(); const second = coordinator.resolveCaller(a.event());
  expect(first?.isCurrent()).toBe(false); expect(coordinator.originWindow(first)).toBeUndefined();
  expect(coordinator.resolveCaller(oldEvent)).toBeUndefined();
  expect(second?.windowId).toBe(first?.windowId); expect(second?.rendererLease).not.toBe(first?.rendererLease);
  coordinator.register(a.window); expect(second?.isCurrent()).toBe(false);
  expect(a.contents.listenerCount('did-frame-navigate')).toBe(1);
  expect(coordinator.resolveCaller(a.event())).toBeUndefined(); a.commit();
  expect(coordinator.resolveCaller(a.event())?.windowId).toBe(second?.windowId);
  coordinator.unregister(a.window); expect(coordinator.size).toBe(0);
  expect(a.contents.listenerCount('did-frame-navigate')).toBe(0);
});

it.each(['close', 'closed', 'destroyed', 'render-process-gone', 'navigation', 'in-page', 'wrong-url', 'dead-frame', 'detached', 'dead-window', 'dead-contents'])(
  'revokes %s without granting authority to a surviving peer', cause => {
    const coordinator = new WindowCoordinator(url, ''), a = windowFixture(), b = windowFixture();
    for (const entry of [a, b]) { coordinator.register(entry.window); entry.commit(); }
    const caller = coordinator.resolveCaller(a.event());
    if (cause === 'close' || cause === 'closed') a.native.emit(cause);
    else if (cause === 'navigation') a.contents.emit('did-start-navigation', { isMainFrame: true });
    else if (cause === 'in-page') a.contents.emit('did-navigate-in-page', {}, url + '#evil', true);
    else if (cause === 'wrong-url') a.contents.mainFrame.url = url + '?evil';
    else if (cause === 'dead-frame') a.contents.mainFrame.isDestroyed = () => true;
    else if (cause === 'detached') a.contents.mainFrame.detached = true;
    else if (cause === 'dead-window') a.native.isDestroyed = () => true;
    else if (cause === 'dead-contents') a.contents.isDestroyed = () => true;
    else a.contents.emit(cause);
    expect(caller?.isCurrent()).toBe(false);
    expect(coordinator.resolveCaller(a.event())).toBeUndefined(); expect(coordinator.originWindow(caller)).toBeUndefined();
    expect(coordinator.resolveCaller(b.event())?.isCurrent()).toBe(true);
  });

it('subframe navigation cannot replace the top-level lease and an incorrect commit cannot authorize', () => {
  const coordinator = new WindowCoordinator(url, ''), a = windowFixture();
  coordinator.register(a.window); a.commit(); const caller = coordinator.resolveCaller(a.event());
  a.contents.emit('did-start-navigation', { isMainFrame: false });
  a.contents.emit('did-frame-navigate', {}, 'https://evil.invalid', 200, 'OK', false);
  expect(caller?.isCurrent()).toBe(true);
  a.contents.mainFrame.url = 'https://evil.invalid'; a.commit();
  expect(coordinator.resolveCaller(a.event())).toBeUndefined();
  a.contents.mainFrame.url = url; expect(coordinator.resolveCaller(a.event())).toBeUndefined();
});

it('fans progress and committed watermarks to every live authorized peer despite a throwing recipient', () => {
  const coordinator = new WindowCoordinator(url, ''), a = windowFixture(), b = windowFixture(), c = windowFixture();
  const sendA = vi.fn(() => { throw new Error('Destroyed between check and send'); }), sendB = vi.fn(), sendC = vi.fn();
  Object.assign(a.contents, { send: sendA }); Object.assign(b.contents, { send: sendB }); Object.assign(c.contents, { send: sendC });
  for (const entry of [a, b, c]) { coordinator.register(entry.window); entry.commit(); }
  c.contents.emit('render-process-gone');
  const progress = { operationId: 'operation', settled: true as const };
  coordinator.sendAcquisitionProgress(progress);
  const commit = { profileEpoch: '00000000-0000-0000-0000-000000000001', commitRevision: 1, change: { kind: 'watermark' as const } };
  coordinator.sendSharedCommit(commit);
  expect(sendA).toHaveBeenCalledTimes(2); expect(sendB.mock.calls).toEqual([['reader:acquisition-progress', progress], ['reader:shared-commit', commit]]);
  expect(sendC).not.toHaveBeenCalled();
});
