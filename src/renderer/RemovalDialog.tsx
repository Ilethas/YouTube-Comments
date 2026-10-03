import { useEffect, useRef } from 'react';
import { translator, Locale } from './i18n';

/** Native modal dialog supplies focus containment and an inert background. */
export function RemovalDialog({ title, locale, pending, error, cancel, remove }: {
  title: string; locale: Locale; pending: boolean; error?: string; cancel: () => void; remove: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const t = translator(locale);
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    element?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      element?.close();
      requestAnimationFrame(() => {
        if (previous?.isConnected) previous.focus();
        else document.querySelector<HTMLElement>('[role=tab][aria-selected=true]')?.focus();
      });
    };
  }, []);
  return <dialog ref={dialog} className="removal-dialog" aria-labelledby="remove-title" aria-describedby="remove-description"
    onCancel={event => { event.preventDefault(); if (!pending) cancel(); }}>
    <h2 id="remove-title">{t('removeTitle')}</h2><p className="remove-item-title">{title}</p>
    <p id="remove-description">{t('removeDescription')}</p>
    {error && <p role="alert">{error}</p>}
    <div className="dialog-actions"><button autoFocus disabled={pending} onClick={cancel}>{t('cancel')}</button>
      <button className="destructive" disabled={pending} onClick={remove}>{t('remove')}</button></div>
  </dialog>;
}
