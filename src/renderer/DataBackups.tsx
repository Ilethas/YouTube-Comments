import { useLayoutEffect, useRef, useState } from 'react';
import type { ReaderApi } from '../shared/reader-api';
import type { Locale } from '../shared/preferences';
import { backupText } from '../shared/data-backup';

/** Pending native dialogs/verification keep this window inert. Restore's explicit
 * Cancel-first confirmation lives in main, after validation of the owned copy. */
export function DataBackups({ api, locale, prepare, onBusy }: {
  api: ReaderApi; locale: Locale; prepare: () => Promise<boolean>; onBusy: (busy: boolean) => void;
}) {
  const t = backupText(locale), dialog = useRef<HTMLDialogElement>(null);
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const [failed, setFailed] = useState(false);
  useLayoutEffect(() => {
    if (!pending) return;
    const element = dialog.current, previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => { element?.close(); if (previous?.isConnected) previous.focus(); };
  }, [pending]);
  async function run(operation: 'createBackup' | 'restoreBackup') {
    if (busy.current) return;
    busy.current = true; onBusy(true); setPending(true); setMessage(undefined); setFailed(false);
    let restarting = false;
    try {
      if (!await prepare()) throw new Error('Pending saves failed');
      const result = await api[operation]();
      if (!result.ok) {
        restarting = result.error.code === 'RECOVERY_REQUIRED';
        setFailed(true);
        setMessage(result.error.code in t ? t[result.error.code as keyof typeof t] : t.failed);
      } else {
        restarting = result.value.status === 'restarting';
        setMessage(result.value.status === 'created' ? `${t.created} ${result.value.destination}`
          : result.value.status === 'cancelled' ? t.cancelled : t.restarting);
      }
    } catch { setFailed(true); setMessage(t.failed); }
    finally { if (!restarting) { busy.current = false; onBusy(false); setPending(false); } }
  }
  return <section className="data-backups" aria-labelledby="data-backups-title">
    <h2 id="data-backups-title">{t.title}</h2><p className="reader-help">{t.explanation}</p>
    <p className="reader-help">{t.privacy}</p>
    <div className="library-entry-actions"><button disabled={pending} onClick={() => void run('createBackup')}>{t.create}</button>
      <button disabled={pending} onClick={() => void run('restoreBackup')}>{t.restore}</button></div>
    {message && !pending && <p role={failed ? 'alert' : 'status'}>{message}</p>}
    {pending && <dialog ref={dialog} className="removal-dialog" aria-labelledby="data-operation-title" onCancel={event => event.preventDefault()}>
      <h2 id="data-operation-title">{t.title}</h2>
      <p className="data-operation-status" role="status">
        <span className="acquisition-spinner" aria-hidden="true" />
        <span>{pending && message ? message : t.running}</span>
      </p>
    </dialog>}
  </section>;
}
