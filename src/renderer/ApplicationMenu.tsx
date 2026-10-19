import { useEffect, useId, useRef, useState } from 'react';
import type { ReaderApi } from '../shared/reader-api';
import type { Locale } from './i18n';
import { translator } from './i18n';
import { CommentContextMenu } from './CommentContextMenu';
import type { CommentMenuTarget } from './CommentContextMenu';
import { ActionIcon } from './ActionIcon';
import { windowShortcutLabel } from '../shared/window-actions';

/** Same native commands as File. Accelerators execute only in Electron main. */
export function ApplicationMenu({ api, locale, disabled }: { api: ReaderApi; locale: Locale; disabled: boolean }) {
  const t = translator(locale), id = useId(), trigger = useRef<HTMLButtonElement>(null);
  const [target, setTarget] = useState<CommentMenuTarget>(), [initialLast, setInitialLast] = useState(false), [failed, setFailed] = useState(false);
  const open = !!target, mac = /Mac/.test(navigator.platform);
  useEffect(() => { if (disabled) setTarget(undefined); }, [disabled]);
  function show(last = false) {
    const origin = trigger.current; if (!origin) return;
    const rect = origin.getBoundingClientRect(); setInitialLast(last);
    setTarget({ id, origin, x: rect.left, y: rect.bottom + 6, selectionText: '' });
  }
  function run(action: 'newWindow' | 'closeWindow' | 'quitApplication') {
    setFailed(false); void api[action]?.().then(result => { if (!result.ok) setFailed(true); }, () => setFailed(true));
  }
  return <>
    <button ref={trigger} className="application-menu-trigger" type="button" disabled={disabled}
      aria-label={t('applicationMenu')} title={t('applicationMenu')} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { if (open) setTarget(undefined); else show(); }} onKeyDown={event => {
        if (event.nativeEvent.isComposing) { event.preventDefault(); return; }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); show(event.key === 'ArrowUp'); }
      }}><ActionIcon name="menu" /></button>
    {target && !disabled && <CommentContextMenu menuId={id} locale={locale} label={t('applicationMenu')} toggleOrigin initialLast={initialLast}
      target={target} dismiss={() => setTarget(undefined)}
      items={[
        { label: t('newWindow'), icon: 'plus', shortcut: windowShortcutLabel('newWindow', mac), disabled: !api.newWindow, run: () => run('newWindow') },
        { label: t('closeWindow'), icon: 'cancel', shortcut: windowShortcutLabel('closeWindow', mac), disabled: !api.closeWindow, run: () => run('closeWindow') },
        { label: t('quitApplication'), icon: 'quit', shortcut: windowShortcutLabel('quitApplication', mac), separatorBefore: true, disabled: !api.quitApplication, run: () => run('quitApplication') },
      ]} />}
    {failed && <span role="alert" className="application-menu-error">{t('windowActionFailed')}</span>}
  </>;
}
