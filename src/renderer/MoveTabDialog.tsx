import { useEffect, useId, useRef, useState } from 'react';
import type { TabTransferApi, TransferDestination, TransferRequest } from '../shared/tab-transfer';
import { translator } from './i18n';
import type { Locale } from './i18n';

/** Explicit keyboard-accessible destination selection; displayed IDs carry no
 * authority. Main rechecks the chosen lease and topology before committing. */
export function MoveTabDialog({ api, locale, dirty, newWindow, cancel, move, fixedDestination }: {
  api: TabTransferApi; locale: Locale; dirty: boolean; newWindow: boolean;
  cancel: () => void; move: (destination: TransferRequest['destination']) => void;
  fixedDestination?: TransferRequest['destination'];
}) {
  const ref = useRef<HTMLDialogElement>(null), title = useId(), t = translator(locale);
  const [destinations, setDestinations] = useState<readonly TransferDestination[]>(), [failed, setFailed] = useState(false), [discard, setDiscard] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal(); ref.current?.querySelector('button')?.focus();
    return () => { ref.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    let current = true;
    void api.destinations().then(result => { if (current) { if (result.ok) setDestinations(result.value); else setFailed(true); } }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [api]);
  const blocked = dirty && !discard;
  return <dialog ref={ref} className="removal-dialog" aria-labelledby={title} onCancel={event => { event.preventDefault(); cancel(); }}>
    <h2 id={title}>{t(newWindow ? 'moveToNewWindow' : 'moveToWindow')}</h2>
    <button autoFocus onClick={cancel}>{t(blocked ? 'keepEditing' : 'cancel')}</button>
    {blocked ? <><p>{t('moveDirtySettings')}</p><button onClick={() => setDiscard(true)}>{t('discardDraft')}</button></> : <>
      {failed && <p role="alert">{t('moveFailed')}</p>}
      {!fixedDestination && !newWindow && !destinations && !failed && <p role="status">{t('loading')}</p>}
      {!fixedDestination && !newWindow && destinations?.map(destination => <button key={destination.windowId} onClick={() => move({ windowId: destination.windowId, expectedRevision: destination.revision, beforeTabId: null })}>
        {t('moveWindowLabel', { number: destination.number })}</button>)}
      {!fixedDestination && !newWindow && destinations?.length === 0 && <p>{t('noMoveWindows')}</p>}
      <button onClick={() => move(fixedDestination ?? 'new')}>{t(fixedDestination && fixedDestination !== 'new' ? 'moveToWindow' : 'moveToNewWindow')}</button>
    </>}
  </dialog>;
}
