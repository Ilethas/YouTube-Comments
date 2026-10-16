import { useRef, useState } from 'react';
import { ActionIcon } from './ActionIcon';
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
      <ActionIcon name="external" />
    </button>
    {failed && <small role="alert">{t('sourceOpenFailed')}</small>}
  </span>;
}
