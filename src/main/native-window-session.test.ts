import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { windowFixture } from './testing/window-fixture';
import { WindowCoordinator } from './window-coordinator';
import { NativeWindowSession } from './native-window-session';
import { ReaderRepository } from './persistence/reader-repository';
import { ReaderService } from './reader-service';
import { ProfileOperationCoordinator } from './profile-operation-coordinator';
import { required } from '../renderer/testing/required';
const { factory, display } = vi.hoisted(() => ({ factory: vi.fn(), display: { id: 1, workArea: { x: 0, y: 0, width: 1280, height: 960 }, scaleFactor: 1.25 } }));
vi.mock('./application-window', () => ({ createApplicationWindow: factory }));
vi.mock('electron', () => ({ screen: { getAllDisplays: () => [display], getPrimaryDisplay: () => display, getDisplayMatching: () => display, on: vi.fn() } }));
const cleanup: (() => void)[] = [];
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); factory.mockReset(); for (const action of cleanup.splice(0)) action(); });
function setup() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reader-m6-native-')), repo = ReaderRepository.open(path.join(root, 'reader.sqlite'));
  const service = new ReaderService(() => repo, ['en']);
  const windows = new WindowCoordinator('file:///app/index.html', ''), native = new NativeWindowSession(service, windows);
  cleanup.push(() => { native.stop(); service.close(); if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('reader-m6-native-')) throw new Error('Unsafe cleanup'); rmSync(root, { recursive: true, force: true }); });
  return { repo, service, windows, native };
}
function fixture() {
  const f = windowFixture(); let normal = { x: 20, y: 30, width: 1000, height: 800 };
  Object.assign(f.native, { loadURL: vi.fn(() => Promise.resolve()), destroy: vi.fn(), getNormalBounds: () => normal, isMaximized: () => false,
    isFullScreen: () => false, isMinimized: () => false, maximize: vi.fn(), setFullScreen: vi.fn(), setFocusable: vi.fn(), showInactive: vi.fn(), focus: vi.fn(), setMinimumSize: vi.fn(),
    setBounds: vi.fn(value => { normal = value; }), close: vi.fn() });
  return { ...f, move: () => { normal = { ...normal, x: 80 }; f.native.emit('move'); } };
}
it('shows only independently bootstrapped windows, focuses intended last-active exactly once, and cleans failed native creation', () => {
  const s = setup(), b = s.repo.createPersistentWindow(), c = s.repo.createPersistentWindow(); s.repo.nativeSession().focused(b);
  const fixtures = [fixture(), fixture(), fixture()]; fixtures.forEach(f => factory.mockReturnValueOnce(f.window));
  const recoveryNotice = vi.fn(); s.native.restore(recoveryNotice);
  for (const f of fixtures) f.commit();
  s.windows.ready(required(s.windows.resolveCaller(fixtures[0].event())));
  s.windows.ready(required(s.windows.resolveCaller(fixtures[2].event())));
  expect(fixtures[0].window.showInactive).not.toHaveBeenCalled();
  s.windows.ready(required(s.windows.resolveCaller(fixtures[1].event())));
  for (const f of fixtures) expect(f.window.showInactive).toHaveBeenCalledOnce();
  expect(fixtures[1].window.focus).toHaveBeenCalledOnce(); expect(fixtures[0].window.focus).not.toHaveBeenCalled();
  expect(recoveryNotice).toHaveBeenCalledExactlyOnceWith(fixtures[1].window);
  for (const f of fixtures) expect(vi.mocked(f.window.showInactive).mock.invocationCallOrder[0]).toBeLessThan(recoveryNotice.mock.invocationCallOrder[0]);
  expect(s.repo.nativeSession().read().windowIds).toContain(c);
  const before = s.repo.nativeSession().read().windowIds;
  factory.mockImplementationOnce(() => { throw new Error('native creation failure'); });
  expect(() => s.windows.createReaderWindow()).toThrow('native creation failure');
  expect(s.repo.nativeSession().read().windowIds).toEqual(before);
});
it('debounces normal geometry, fences ordinary writes behind M3 and checkpoints before terminal fencing', async () => {
  vi.useFakeTimers(); const s = setup(), f = fixture(); factory.mockReturnValue(f.window); s.native.restore(); f.commit();
  s.windows.ready(required(s.windows.resolveCaller(f.event())));
  const id = s.repo.initialWindowId(); f.move(); f.move();
  expect(s.repo.nativeSession().geometry(id).revision).toBe(0);
  const lifecycle = new ProfileOperationCoordinator(() => [], () => undefined, () => s.repo.stamp(), () => ({ ok: true, value: null }));
  s.service.attachLifecycle(lifecycle); await lifecycle.begin('backup');
  await vi.advanceTimersByTimeAsync(300);
  expect(s.repo.nativeSession().geometry(id).revision).toBe(0);
  expect(() => s.service.mutateNativeSession(store => store.saveGeometry(id, { version: 1, normal: { x: 0, y: 0, width: 900, height: 600 }, maximized: false, fullscreen: false, display: null }, 0))).toThrow('Profile busy');
  s.service.flushNativeCheckpoint(); expect(s.repo.nativeSession().geometry(id).geometry?.normal.x).toBe(80);
  lifecycle.executePhase(); lifecycle.accept(); lifecycle.restarting();
  f.move(); await vi.advanceTimersByTimeAsync(300);
  expect(s.repo.nativeSession().geometry(id).revision).toBe(1);
  expect(() => s.service.mutateNativeSession(store => store.closed(id), true)).toThrow('Profile busy');
});
it('compensates asynchronous trusted-document load failure without leaving invisible restore membership', async () => {
  const s = setup(), first = fixture(); factory.mockReturnValueOnce(first.window); s.native.restore(); first.commit();
  s.windows.ready(required(s.windows.resolveCaller(first.event())));
  const before = s.repo.nativeSession().read().windowIds, broken = fixture();
  Object.assign(broken.native, { loadURL: () => Promise.reject(new Error('injected load failure')) });
  factory.mockReturnValueOnce(broken.window); vi.spyOn(console, 'error').mockImplementation(() => undefined);
  s.windows.createReaderWindow(); await Promise.resolve();
  expect(s.repo.nativeSession().read().windowIds).toEqual(before);
  expect(s.windows.size).toBe(1); expect(broken.window.destroy).toHaveBeenCalledOnce();
});
it('native close cancellation durably re-enrolls the same window and retains its current document authority', async () => {
  const s = setup(); s.repo.createPersistentWindow(); const a = fixture(), b = fixture();
  factory.mockReturnValueOnce(a.window).mockReturnValueOnce(b.window); s.native.restore();
  for (const f of [a, b]) { f.commit(); s.windows.ready(required(s.windows.resolveCaller(f.event()))); }
  s.windows.setLifecycle({ close: vi.fn(), reload: vi.fn(), lost: vi.fn(), restored: vi.fn(), canRecover: () => true });
  const caller = required(s.windows.resolveCaller(a.event()));
  Object.assign(a.native, { close: () => { const event = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } }; a.native.emit('close', event); } });
  a.native.on('close', event => event.preventDefault());
  s.windows.finishClose(caller); expect(s.repo.nativeSession().read().windowIds).not.toContain(caller.windowId);
  await Promise.resolve();
  expect(s.repo.nativeSession().read().windowIds).toContain(caller.windowId); expect(caller.isCurrent()).toBe(true);
  expect(s.windows.size).toBe(2);
});
it('Quit construction settlement waits for failed provisional loading to compensate before capturing the live set', async () => {
  const s = setup(), first = fixture(); factory.mockReturnValueOnce(first.window); s.native.restore(); first.commit();
  s.windows.ready(required(s.windows.resolveCaller(first.event()))); await s.windows.settleCreation();
  const ids = s.repo.nativeSession().read().windowIds, next = fixture(); let rejectLoad: (error: Error) => void = () => undefined;
  Object.assign(next.native, { loadURL: () => new Promise<void>((_resolve, reject) => { rejectLoad = reject; }) });
  factory.mockReturnValueOnce(next.window); s.windows.createReaderWindow();
  let settled = false; const pending = s.windows.settleCreation().then(() => { settled = true; }); await Promise.resolve();
  expect(settled).toBe(false); expect(s.repo.nativeSession().read().windowIds).toHaveLength(2);
  vi.spyOn(console, 'error').mockImplementation(() => undefined); rejectLoad(new Error('failed construction')); await pending;
  expect(s.repo.nativeSession().read().windowIds).toEqual(ids);
});
it('hung native loading fails bounded Quit preparation without discarding its acknowledged restore membership', async () => {
  vi.useFakeTimers(); const s = setup(), first = fixture(); factory.mockReturnValueOnce(first.window); s.native.restore(); await s.windows.settleCreation();
  const next = fixture(); Object.assign(next.native, { loadURL: () => new Promise<void>(() => undefined) });
  factory.mockReturnValueOnce(next.window); s.windows.createReaderWindow(); const before = s.repo.nativeSession().read();
  const failed = expect(s.windows.settleCreation(100)).rejects.toThrow('Reader creation unavailable');
  await vi.advanceTimersByTimeAsync(101); await failed;
  expect(s.repo.nativeSession().read()).toEqual(before); expect(s.windows.size).toBe(2);
});
it('a requested New Window finishing during startup joins the ready show batch instead of remaining hidden', () => {
  const s = setup(); s.repo.createPersistentWindow(); const a = fixture(), b = fixture(), extra = fixture();
  factory.mockReturnValueOnce(a.window).mockReturnValueOnce(b.window).mockReturnValueOnce(extra.window); s.native.restore();
  a.commit(); b.commit(); s.windows.ready(required(s.windows.resolveCaller(a.event())));
  s.windows.createReaderWindow(); extra.commit(); s.windows.ready(required(s.windows.resolveCaller(extra.event())));
  expect(extra.window.showInactive).not.toHaveBeenCalled();
  s.windows.ready(required(s.windows.resolveCaller(b.event())));
  for (const f of [a, b, extra]) expect(f.window.showInactive).toHaveBeenCalledOnce();
  expect(extra.window.focus).toHaveBeenCalledOnce();
  expect(s.repo.nativeSession().read().windowIds).toHaveLength(3);
});
it('minimizing a maximized native reader preserves its underlying expanded intent rather than persisting false', () => {
  const s = setup(), f = fixture(); let minimized = false, maximized = false;
  Object.assign(f.native, { isMinimized: () => minimized, isMaximized: () => maximized, maximize: () => { maximized = true; } });
  const id = s.repo.initialWindowId(); s.repo.nativeSession().saveGeometry(id, { version: 1, normal: f.window.getNormalBounds(), maximized: true, fullscreen: false, display: null }, 0);
  factory.mockReturnValueOnce(f.window); s.native.restore(); f.commit(); s.windows.ready(required(s.windows.resolveCaller(f.event()))); s.native.flush();
  minimized = true; maximized = false; s.native.flush();
  expect(s.repo.nativeSession().geometry(id).geometry?.maximized).toBe(true);
});
