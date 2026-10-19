/** One app-owned outline vocabulary. Decorative vectors inherit currentColor;
 * every containing control owns its localized accessible name. */
const paths = {
  menu: 'M4 6h16 M4 12h16 M4 18h16', quit: 'M12 3v9 M6 5a9 9 0 1 0 12 0',
  chevronRight: 'm9 5 7 7-7 7', chevronDown: 'm5 9 7 7 7-7',
  chevronUp: 'm5 15 7-7 7 7', select: 'm3 6 2 2 4-4 M12 6h9 M3 13l2 2 4-4 M12 13h9 M3 20h6 M12 20h9',
  expandAll: 'm5 4 7 7 7-7 M5 13l7 7 7-7', collapseAll: 'm5 11 7-7 7 7 M5 20l7-7 7 7',
  refresh: 'M20 7v5h-5 M4 17v-5h5 M6 7a7 7 0 0 1 12-2l2 2 M4 17l2 2a7 7 0 0 0 12-2',
  cancel: 'm6 6 12 12 M6 18 18 6',
  plus: 'M12 5v14 M5 12h14', window: 'M3 5h18v14H3Z M3 9h18',
  seen: 'm2 12 4 4L16 6 M10 14l2 2L22 6',
  unseen: 'm3 3 18 18 M10 5c5-1 9 3 11 7-1 2-2 4-4 5 M7 7c-2 1-4 3-5 5 3 6 8 9 14 6 M10 10a3 3 0 0 0 4 4',
  translate: 'm5 8 6 7 M3 5h12 M9 3v2c0 5-3 8-6 10 M13 21l4-10 4 10 M15 17h4',
  external: 'M14 3h7v7 M21 3 11 13 M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6',
  copy: 'M9 9h12v12H9Z M5 15H3V3h12v2',
  undo: 'M3 10h11a7 7 0 0 1 0 14 M3 10l6-6 M3 10l6 6',
  library: 'M4 3h4v18H4Z M11 3h3v18h-3Z M17 5l3-1 3 16-3 1Z',
  settings: 'm9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0',
  video: 'M3 5h18v14H3Z m7 4 5 3-5 3Z',
  post: 'M4 4h16v12H9l-5 4Z M8 8h8 M8 12h6',
} as const;
export function ActionIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={paths[name]} /></svg>;
}
