import { expect, it } from 'vitest';
import { acceptsOutsideDetach } from './tab-drag-outcome';
import type { DragNativeSample } from './tab-drag-outcome';

const sample: DragNativeSample = { cursor: { x: -50, y: -40 }, sourceVisible: true,
  windows: [{ bounds: { x: 0, y: 0, width: 100, height: 100 }, visible: true, minimized: false, focused: true }] };
it.each(['desktop release', 'unobserved Escape outside', 'external application release', 'taskbar release'])('%s may produce the same accepted heuristic evidence; this is not positive release detection', () => {
  expect(acceptsOutsideDetach(sample, false)).toBe(true);
});
it('recent app hover and invisible source independently block detachment', () => {
  expect(acceptsOutsideDetach(sample, true)).toBe(false);
  expect(acceptsOutsideDetach({ ...sample, sourceVisible: false }, false)).toBe(false);
});
it('focused and unfocused visible peer rectangles suppress creation; rectangles never choose a recipient', () => {
  const inside = { ...sample, cursor: { x: 10, y: 10 } };
  expect(acceptsOutsideDetach(inside, false)).toBe(false);
  expect(acceptsOutsideDetach({ ...inside, windows: [{ ...inside.windows[0], focused: false }] }, false)).toBe(false);
  for (const flags of [{ minimized: true }, { visible: false }]) {
    expect(acceptsOutsideDetach({ ...inside, windows: [{ ...inside.windows[0], ...flags }] }, false)).toBe(true);
  }
});
it('nonfinite cursor coordinates cannot create a provisional native', () => {
  expect(acceptsOutsideDetach({ ...sample, cursor: { x: NaN, y: 0 } }, false)).toBe(false);
});
