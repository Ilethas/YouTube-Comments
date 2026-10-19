import { useEffect, useState } from 'react';
import { CommentContextMenu } from './CommentContextMenu';
import type { CommentMenuTarget } from './CommentContextMenu';
import type { WorkspaceState, WorkspaceTab } from '../domain/workspace';
import { useTabStrip } from './use-tab-strip';
import { translator, Locale } from './i18n';
import { TabIcon } from './TabIcon';
import { ActionIcon } from './ActionIcon';
import { reorderHelp, shortcutHint } from './shortcuts';
import type { TabTransferApi } from '../shared/tab-transfer';

interface Props {
  workspace: WorkspaceState;
  locale: Locale;
  disabled: boolean;
  label: (tab: WorkspaceTab) => string;
  icon: (tab: WorkspaceTab) => 'video' | 'post' | 'library' | 'settings';
  activate: (id: string, focus?: boolean) => void;
  close: (id: string) => void;
  transfer?: (id: string, newWindow: boolean) => void;
  dragApi?: TabTransferApi;
  duplicate?: (sourceViewId: string) => void;
  move: (id: string, toIndex: number) => void;
}

/** Native HTML adapter shares M7 authority; keyboard alternatives stay available. */
export function WorkspaceTabs({ workspace, locale, disabled, label, icon, activate, close, move, duplicate, transfer, dragApi }: Props) {
  const t = translator(locale);
  const [menu, setMenu] = useState<CommentMenuTarget>();
  useEffect(() => { setMenu(undefined); }, [workspace.revision, disabled]);
  function openMenu(id: string, origin: HTMLElement, x: number, y: number) {
    if (disabled || !duplicate && !transfer) return;
    setMenu({ id, origin, x, y, selectionText: '' });
  }
  const { strip, dragging, shown, suppressClick, begin, newPress, pointerUp, pointerCancel, dragStart, dragOver, dragLeave, drop, dragEnd, insertion, status } = useTabStrip(workspace, disabled, move, dragApi);
  return <><div ref={strip} className="tabs" role="tablist" aria-label={t('discussions')} aria-describedby="tab-reorder-help"
    data-empty={shown.tabs.length === 0} data-drop-active={insertion !== undefined}
    data-insert-end={insertion === null} onPointerDownCapture={newPress} onPointerUp={pointerUp} onPointerCancel={pointerCancel}
    onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop} onDragEnd={dragEnd}
    onClickCapture={event => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } }}>
    <span id="tab-reorder-help" className="visually-hidden">{reorderHelp(locale)}</span>
    {!shown.tabs.length && <span className="tab-drop-empty" aria-hidden="true"><ActionIcon name="plus" />{t(insertion !== undefined ? 'tabDropReady' : 'tabDropEmpty')}</span>}
    {shown.tabs.map((tab, index) => <div key={tab.id} className="tab" role="presentation" data-tab-id={tab.id} data-tab-item-id={tab.kind === 'discussion' ? tab.itemId : undefined}
      data-active={workspace.activeTabId === tab.id} data-dragging={dragging === tab.id} data-insert-before={insertion === tab.id}>
      <button role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.kind === 'discussion' ? tab.id : tab.kind}`}
        aria-haspopup={transfer || tab.kind === 'discussion' && duplicate ? 'menu' : undefined}
        onContextMenu={event => {
          if (!transfer && (tab.kind !== 'discussion' || !duplicate)) return;
          event.preventDefault(); openMenu(tab.id, event.currentTarget, event.clientX, event.clientY);
        }}
        disabled={disabled} aria-selected={workspace.activeTabId === tab.id} tabIndex={workspace.activeTabId === tab.id ? 0 : -1}
        aria-label={`${t(icon(tab))}: ${label(tab)}`} title={`${t(icon(tab))}: ${label(tab)} · ${reorderHelp(locale)}${tab.kind === 'discussion' && duplicate ? ` \u00b7 ${t('tabActionsHint')}` : ''}`}
        onClick={event => { if (!suppressClick.current || event.detail === 0) activate(tab.id); }}
        onPointerDown={event => begin(tab.id, index, event)}
        draggable={!disabled && !!dragApi} onDragStart={event => dragStart(tab.id, event)}
        onKeyDown={event => {
          if ((transfer || tab.kind === 'discussion' && duplicate) && (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey)) {
            event.preventDefault(); event.stopPropagation(); const rect = event.currentTarget.getBoundingClientRect();
            openMenu(tab.id, event.currentTarget, rect.left, rect.bottom); return;
          }
          if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            const next = index + (event.key === 'ArrowLeft' ? -1 : 1);
            if (next >= 0 && next < shown.tabs.length) move(tab.id, next);
            return;
          }
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? shown.tabs.length - 1
            : event.key === 'ArrowRight' ? (index + 1) % shown.tabs.length
              : event.key === 'ArrowLeft' ? (index + shown.tabs.length - 1) % shown.tabs.length : undefined;
          if (next !== undefined) { event.preventDefault(); activate(shown.tabs[next].id, true); }
        }}>
        <TabIcon kind={icon(tab)} /><span className="tab-title">{label(tab)}</span>
      </button>
      <button className="tab-close" disabled={disabled} aria-label={t('closeTab', { title: label(tab) })}
        title={workspace.activeTabId === tab.id ? shortcutHint(locale, 'close-tab', t('closeTab', { title: label(tab) })) : t('closeTab', { title: label(tab) })}
        onClick={() => close(tab.id)}><ActionIcon name="cancel" /></button>
    </div>)}
  </div>{status && <span className="visually-hidden" role="status" aria-live="polite">{t(status)}</span>}{menu && (duplicate || transfer) && !disabled && <CommentContextMenu target={menu} locale={locale} label={t('tabActions')} dismiss={() => setMenu(undefined)}
    items={[
      ...(duplicate && workspace.tabs.find(tab => tab.id === menu.id)?.kind === 'discussion' ? [{ label: t('duplicateTab'), icon: 'copy' as const, run: () => duplicate(menu.id) }] : []),
      ...(transfer ? [{ label: t('moveToWindow'), icon: 'chevronRight' as const, run: () => transfer(menu.id, false) },
        { label: t('moveToNewWindow'), icon: 'chevronRight' as const, run: () => transfer(menu.id, true) }] : []),
    ]} />}</>;
}
