/** Optional development profiling only: counts actual presentation work, not DOM visibility.
 * Enable with window.__readerWork = {} in DevTools; production never records anything. */
declare global {
  interface Window { __readerWork?: Record<string, number> }
}
export function recordRenderWork(kind: string, id: string): void {
  if (process.env.NODE_ENV === 'production' || !window.__readerWork) return;
  const key = `${kind}:${id}`;
  window.__readerWork[key] = (window.__readerWork[key] ?? 0) + 1;
}
