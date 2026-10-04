import type { WorkspaceState, WorkspaceTab } from '../domain/workspace';
import { useTabStrip } from './use-tab-strip';
import { translator, Locale } from './i18n';
import { TabIcon } from './TabIcon';
import { reorderHelp, shortcutHint } from './shortcuts';

interface Props {
  workspace: WorkspaceState;
  locale: Locale;
  disabled: boolean;
  label: (tab: WorkspaceTab) => string;
  icon: (tab: WorkspaceTab) => 'video' | 'post' | 'library' | 'settings';
  activate: (id: string, focus?: boolean) => void;
  close: (id: string) => void;
  move: (id: string, toIndex: number) => void;
}

/** Pointer capture keeps internal dragging separate from external drop data.
 * Preview is local; only pointer-up commits one final index. Alt+arrows reorder. */
export function WorkspaceTabs({ workspace, locale, disabled, label, icon, activate, close, move }: Props) {
  const t = translator(locale);
  const { strip, dragging, shown, suppressClick, begin, newPress, pointerMove, pointerUp, pointerCancel, lostCapture } = useTabStrip(workspace, disabled, move, activate);
  return <div ref={strip} className="tabs" role="tablist" aria-label={t('discussions')} aria-describedby="tab-reorder-help"
    onPointerDownCapture={newPress} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerCancel} onLostPointerCapture={lostCapture}
    onClickCapture={event => { if (suppressClick.current && event.detail > 0) { event.preventDefault(); event.stopPropagation(); } }}>
    <span id="tab-reorder-help" className="visually-hidden">{reorderHelp(locale)}</span>
    {shown.tabs.map((tab, index) => <div key={tab.id} className="tab" role="presentation" data-tab-id={tab.id}
      data-active={workspace.activeTabId === tab.id} data-dragging={dragging === tab.id}>
      <button role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.kind === 'discussion' ? tab.itemId : tab.id}`}
        disabled={disabled} aria-selected={workspace.activeTabId === tab.id} tabIndex={workspace.activeTabId === tab.id ? 0 : -1}
        aria-label={`${t(icon(tab))}: ${label(tab)}`} title={`${t(icon(tab))}: ${label(tab)} · ${reorderHelp(locale)}`}
        onClick={event => { if (!suppressClick.current || event.detail === 0) activate(tab.id); }}
        onPointerDown={event => begin(tab.id, index, event)}
        onKeyDown={event => {
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
        onClick={() => close(tab.id)}>×</button>
    </div>)}
  </div>;
}
