import { useEffect, useId, useRef, useState } from 'react';
import type { TabTransferApi, TransferDestination, TransferRequest } from '../shared/tab-transfer';
import { countLabel, translator } from './i18n';
import type { Locale } from './i18n';
import { ActionIcon } from './ActionIcon';
import { TabIcon } from './TabIcon';

/** Displayed destination snapshots carry no authority. Selection never starts a
 * transfer; main rechecks the chosen document and topology after explicit Move. */
export function MoveTabDialog({ api, locale, dirty, newWindow, cancel, move, fixedDestination, tabTitle, tabKind }: {
  api: TabTransferApi; locale: Locale; dirty: boolean; newWindow: boolean;
  tabTitle: string; tabKind: 'video' | 'post' | 'library' | 'settings';
  cancel: () => void; move: (destination: TransferRequest['destination']) => void;
  fixedDestination?: TransferRequest['destination'];
}) {
  const ref = useRef<HTMLDialogElement>(null), cancelButton = useRef<HTMLButtonElement>(null), id = useId(), t = translator(locale);
  const [destinations, setDestinations] = useState<readonly TransferDestination[]>(), [failed, setFailed] = useState(false), [discard, setDiscard] = useState(false);
  const [selected, setSelected] = useState<string | undefined>(newWindow ? 'new' : undefined);
  const submitted = useRef(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, dialog = ref.current;
    dialog?.showModal(); cancelButton.current?.focus();
    return () => { dialog?.close(); if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => {
    if (fixedDestination || newWindow) return;
    let current = true;
    void api.destinations().then(result => { if (current) { if (result.ok) setDestinations(result.value); else setFailed(true); } }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [api, fixedDestination, newWindow]);
  const blocked = dirty && !discard;
  const peer = destinations?.find(destination => destination.windowId === selected);
  const destination = fixedDestination ?? (selected === 'new' ? 'new' : peer ? { windowId: peer.windowId, expectedRevision: peer.revision, beforeTabId: null } : undefined);
  return <dialog ref={ref} className="move-tab-dialog" aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
    onCancel={event => { event.preventDefault(); cancel(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (blocked || !destination || submitted.current) return;
      submitted.current = true; move(destination);
    }}>
      <header className="move-tab-header">
        <h2 id={`${id}-title`}>{t('moveTabTitle')}</h2>
        <p id={`${id}-description`}>{t(fixedDestination ? 'moveTabFixedHelp' : 'moveTabHelp')}</p>
      </header>
      <div className="move-tab-body">
        <div className="move-tab-source">
          <TabIcon kind={tabKind} />
          <div><span className="move-tab-caption">{t('moveTabSource')}</span><strong title={tabTitle}>{tabTitle}</strong></div>
        </div>
        {blocked ? <p className="move-tab-warning" role="status">{t('moveDirtySettings')}</p> : fixedDestination && fixedDestination !== 'new'
          ? <p className="move-tab-fixed"><ActionIcon name="window" />{t('moveTabFixedDestination')}</p>
          : <fieldset className="move-tab-destinations">
            <legend>{t('moveTabDestination')}</legend>
            {!newWindow && !fixedDestination && <div className="move-tab-window-list">
              {failed && <p role="alert">{t('moveDestinationsFailed')}</p>}
              {!destinations && !failed && <p role="status">{t('loading')}</p>}
              {destinations?.length === 0 && <p>{t('noMoveWindows')}</p>}
              {destinations?.map(destination => {
                const active = destination.activeTab;
                const detail = active ? t('moveWindowActive', { title: active.kind === 'discussion' ? active.title ?? t('discussion') : t(active.kind) }) : t('moveWindowEmpty');
                return <label className="move-tab-option" key={destination.windowId}>
                  <input type="radio" name={`${id}-destination`} value={destination.windowId} checked={selected === destination.windowId}
                    onChange={() => setSelected(destination.windowId)} />
                  <ActionIcon name="window" />
                  <span className="move-tab-option-text"><strong>{t('moveWindowLabel', { number: destination.number })}</strong>
                    <span title={detail}>{detail}</span></span>
                  <span className="move-tab-count">{countLabel(locale, 'moveWindowTabs', destination.tabCount)}</span>
                </label>;
              })}
            </div>}
            <label className="move-tab-option move-tab-new">
              <input type="radio" name={`${id}-destination`} value="new" checked={destination === 'new'}
                onChange={() => setSelected('new')} />
              <ActionIcon name="plus" />
              <span className="move-tab-option-text"><strong>{t('moveToNewWindow')}</strong><span>{t('moveNewWindowHelp')}</span></span>
            </label>
          </fieldset>}
      </div>
      <footer className="move-tab-footer">
        <button ref={cancelButton} type="button" onClick={cancel}>{t(blocked ? 'keepEditing' : 'cancel')}</button>
        {blocked ? <button type="button" className="move-tab-primary" onClick={() => setDiscard(true)}>{t('discardDraft')}</button>
          : <button type="submit" className="move-tab-primary" disabled={!destination}>{t('moveTabConfirm')}</button>}
      </footer>
    </form>
  </dialog>;
}
