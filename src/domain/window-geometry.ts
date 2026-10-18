/** Native rectangles are Electron DIP, including negative virtual-desktop origins.
 * Scale and work area are evidence only; never apply a global DPI multiplier. */
export interface WindowRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface WindowDisplay { readonly id: string; readonly workArea: WindowRect; readonly scaleFactor: number }
export interface WindowGeometry {
  readonly version: 1;
  readonly normal: WindowRect;
  readonly maximized: boolean;
  readonly fullscreen: boolean;
  readonly display: WindowDisplay | null;
}
const coordinate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Number.isInteger(n) && Math.abs(n) <= 1000000;
export function isWindowRect(value: unknown): value is WindowRect {
  if (!value || typeof value !== 'object') return false;
  const r = value as WindowRect;
  return coordinate(r.x) && coordinate(r.y) && coordinate(r.width) && coordinate(r.height) && r.width > 0 && r.height > 0;
}
export function isWindowGeometry(value: unknown): value is WindowGeometry {
  if (!value || typeof value !== 'object') return false;
  const g = value as WindowGeometry, d = g.display;
  return g.version === 1 && isWindowRect(g.normal) && typeof g.maximized === 'boolean' && typeof g.fullscreen === 'boolean'
    && (d === null || !!d && typeof d.id === 'string' && d.id.length > 0 && d.id.length <= 128 && isWindowRect(d.workArea)
      && Number.isFinite(d.scaleFactor) && d.scaleFactor >= 0.1 && d.scaleFactor <= 16);
}
const overlap = (a: WindowRect, b: WindowRect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
/** Select the recorded connected display, otherwise greatest DIP overlap, then
 * primary. Clamp the whole normal rectangle into its CURRENT work area. This
 * stronger-than-titlebar rule guarantees reachability even on tiny displays. */
export function restoreWindowGeometry(saved: unknown, displays: readonly WindowDisplay[], primaryId?: string) {
  const current = displays.filter(d => isWindowRect(d.workArea));
  if (!current.length) throw new Error('No usable display');
  const g = isWindowGeometry(saved) ? saved : undefined;
  const primary = current.find(d => d.id === primaryId) ?? current[0];
  const matched = g?.display && current.find(d => d.id === g.display?.id);
  const best = g && [...current].sort((a, b) => overlap(g.normal, b.workArea) - overlap(g.normal, a.workArea))[0];
  const display = matched || (best && g && overlap(g.normal, best.workArea) > 0 ? best : primary);
  const area = display.workArea;
  const minWidth = Math.min(720, area.width), minHeight = Math.min(520, area.height);
  const width = Math.min(area.width, Math.max(minWidth, g?.normal.width ?? 1240));
  const height = Math.min(area.height, Math.max(minHeight, g?.normal.height ?? 900));
  const x = Math.round(Math.max(area.x, Math.min(area.x + area.width - width, g?.normal.x ?? area.x + (area.width - width) / 2)));
  const y = Math.round(Math.max(area.y, Math.min(area.y + area.height - height, g?.normal.y ?? area.y + (area.height - height) / 2)));
  return { normal: { x, y, width, height }, minWidth, minHeight, maximized: g?.maximized ?? false, fullscreen: g?.fullscreen ?? false, display };
}
