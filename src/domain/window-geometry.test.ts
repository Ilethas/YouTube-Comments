import { expect, it } from 'vitest';
import { isWindowGeometry, restoreWindowGeometry } from './window-geometry';
import type { WindowDisplay, WindowGeometry } from './window-geometry';
const primary: WindowDisplay = { id: 'p', workArea: { x: 0, y: 0, width: 1920, height: 1040 }, scaleFactor: 1.5 };
const left: WindowDisplay = { id: 'l', workArea: { x: -2560, y: -400, width: 2560, height: 1400 }, scaleFactor: 2 };
const saved: WindowGeometry = { version: 1, normal: { x: -2400, y: -200, width: 1240, height: 900 }, maximized: false, fullscreen: false, display: left };
it('preserves negative DIP coordinates with mixed scale metadata and never scales bounds', () => {
  expect(restoreWindowGeometry(saved, [primary, left], 'p').normal).toEqual(saved.normal);
  expect(restoreWindowGeometry({ ...saved, display: { ...left, scaleFactor: 1 } }, [primary, left]).normal).toEqual(saved.normal);
});
it('clamps disconnected and rearranged monitors into current work areas', () => {
  const value = restoreWindowGeometry(saved, [primary], 'p');
  expect(value.normal).toEqual({ x: 0, y: 0, width: 1240, height: 900 });
  const moved = { ...left, workArea: { ...left.workArea, x: 1920, y: 0 } };
  expect(restoreWindowGeometry(saved, [primary, moved]).normal.x).toBe(1920);
});
it('uses overlap when display evidence is missing and primary for wholly offscreen data', () => {
  expect(restoreWindowGeometry({ ...saved, display: null }, [primary, left], 'p').display.id).toBe('l');
  expect(restoreWindowGeometry({ ...saved, normal: { ...saved.normal, x: 990000 } }, [primary, left], 'p').display.id).toBe('l');
  expect(restoreWindowGeometry({ ...saved, display: null, normal: { ...saved.normal, x: 990000 } }, [primary, left], 'p').display.id).toBe('p');
});
it.each([NaN, Infinity, -Infinity, 1e12, -1e12, '0', null])('rejects invalid coordinate %s with the nominal centered fallback', x => {
  const invalid = { ...saved, normal: { ...saved.normal, x } };
  expect(isWindowGeometry(invalid)).toBe(false);
  expect(restoreWindowGeometry(invalid, [primary]).normal).toEqual({ x: 340, y: 70, width: 1240, height: 900 });
});
it.each([{ x: -80, y: 3, width: 320, height: 200 }, { x: 0, y: 0, width: 1, height: 1 }])('adapts minimums and keeps the whole window reachable on tiny work areas', workArea => {
  const result = restoreWindowGeometry(saved, [{ ...primary, workArea }]);
  expect(result.normal).toEqual(workArea);
  expect(result.minWidth).toBe(workArea.width); expect(result.minHeight).toBe(workArea.height);
});
it('separates normal bounds from maximize/fullscreen and does not restore minimized', () => {
  const result = restoreWindowGeometry({ ...saved, maximized: true, fullscreen: true, minimized: true }, [left]);
  expect(result).toMatchObject({ normal: saved.normal, maximized: true, fullscreen: true });
  expect(result).not.toHaveProperty('minimized');
});
it('unrecorded v12/v13 geometry preserves default size and shrinks only to the available area', () => {
  expect(restoreWindowGeometry(null, [primary]).normal).toMatchObject({ width: 1240, height: 900 });
  expect(restoreWindowGeometry(undefined, [{ ...primary, workArea: { x: 0, y: 0, width: 800, height: 600 } }]).normal).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  expect(() => restoreWindowGeometry(null, [])).toThrow('No usable display');
});
