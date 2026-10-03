/** App-owned decorative vectors; the surrounding control supplies localized text. */
export function TabIcon({ kind }: { kind: 'video' | 'post' | 'library' | 'settings' }) {
  return <svg className="tab-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.7">
    {kind === 'video' ? <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="m10 9 5 3-5 3Z" /></>
      : kind === 'post' ? <path d="M4 4h16v12H9l-5 4Z M8 8h8 M8 12h6" />
        : kind === 'library' ? <path d="M4 3h4v18H4Z M11 3h3v18h-3Z M17 5l3-1 3 16-3 1Z" />
          : <><path d="m9 3 6 0 1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1Z" /><circle cx="12" cy="12" r="3" /></>}
  </svg>;
}
