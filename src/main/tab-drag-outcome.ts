import type { WindowRect } from '../domain/window-geometry';

export interface DragNativeSample {
  readonly cursor: { readonly x: number; readonly y: number };
  readonly windows: readonly { readonly bounds: WindowRect; readonly visible: boolean; readonly minimized: boolean; readonly focused: boolean }[];
  readonly sourceVisible: boolean;
}
/** Replaceable gesture outcome policy, never an ownership or topmost-window test.
 * An unseen Escape, desktop, taskbar and another app may have identical evidence. */
export function acceptsOutsideDetach(sample: DragNativeSample, recentAppHover: boolean): boolean {
  const { cursor } = sample;
  if (!sample.sourceVisible || recentAppHover || !Number.isFinite(cursor.x) || !Number.isFinite(cursor.y)) return false;
  const containing = sample.windows.filter(w => w.visible && !w.minimized && cursor.x >= w.bounds.x && cursor.y >= w.bounds.y
    && cursor.x < w.bounds.x + w.bounds.width && cursor.y < w.bounds.y + w.bounds.height);
  if (containing.some(w => w.focused)) return false;
  // Conservative peer containment also suppresses creation while a real drop's
  // offer is crossing processes. Even an occluded rectangle only blocks detach;
  // it can NEVER choose/authorize an attachment destination.
  return containing.length === 0;
}
