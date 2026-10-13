import { useRef, useState } from 'react';
import type { Result } from '../shared/reader-api';
import { translator } from './i18n';
import type { Locale } from './i18n';

/** Renderer supplies application identity only; main owns destination and browser. */
export function SourceAction({ itemId, locale, open }: {
  itemId: string; locale: Locale; open: (itemId: string) => Promise<Result<null>>;
}) {
  const t = translator(locale), busy = useRef(false);
  const [pending, setPending] = useState(false), [failed, setFailed] = useState(false);
  async function activate() {
    if (busy.current) return;
    busy.current = true; setPending(true); setFailed(false);
    try { setFailed(!(await open(itemId)).ok); }
    catch { setFailed(true); }
    finally { busy.current = false; setPending(false); }
  }
  return <span className="source-action">
    <button className="source-button" title={t('openSource')} aria-label={t('openSource')} disabled={pending} onClick={() => { void activate(); }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M14 3h7v7M21 3l-11 11M10 3H4a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-6" />
      </svg>
    </button>
    {failed && <small role="alert">{t('sourceOpenFailed')}</small>}
  </span>;
}
