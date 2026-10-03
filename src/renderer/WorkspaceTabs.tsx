import { useRef, useState } from 'react';
import type { WorkspaceState, WorkspaceTab } from '../domain/workspace';
import { moveWorkspaceTab } from '../domain/workspace';
import { translator, Locale } from './i18n';
import { TabIcon } from './TabIcon';

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
  const [preview, setPreview] = useState<WorkspaceState>();
  const [dragging, setDragging] = useState<string>();
  const drag = useRef<{ id: string; x: number; pointer: number; moved: boolean; index: number; base: WorkspaceState }>();
  const suppressClick = useRef(false);
  const strip = useRef<HTMLDivElement>(null);
  const shown = preview && drag.current?.base.revision === workspace.revision ? preview : workspace;
  function finish(commit: boolean) {
    const value = drag.current;
    drag.current = undefined;
    setDragging(undefined); setPreview(undefined);
    if (value?.moved) {
      suppressClick.current = true;
      if (commit && value.base.revision === workspace.revision) move(value.id, value.index);
      setTimeout(() => { suppressClick.current = false; }, 0);
    }
  }
  return <div ref={strip} className="tabs" role="tablist" aria-label={t('discussions')} aria-describedby="tab-reorder-help">
    <span id="tab-reorder-help" className="visually-hidden">{t('reorderHelp')}</span>
    {shown.tabs.map((tab, index) => <div key={tab.id} className="tab" role="presentation" data-tab-id={tab.id}
      data-active={workspace.activeTabId === tab.id} data-dragging={dragging === tab.id}>
      <button role="tab" id={`tab-${tab.id}`} aria-controls={`panel-${tab.kind === 'discussion' ? tab.itemId : tab.id}`}
        disabled={disabled} aria-selected={workspace.activeTabId === tab.id} tabIndex={workspace.activeTabId === tab.id ? 0 : -1}
        aria-label={`${t(icon(tab))}: ${label(tab)}`} title={`${t(icon(tab))}: ${label(tab)} · ${t('reorderHelp')}`}
        onClick={() => { if (!suppressClick.current) activate(tab.id); }}
        onPointerDown={event => {
          if (event.button !== 0 || disabled) return;
          drag.current = { id: tab.id, x: event.clientX, pointer: event.pointerId, moved: false, index, base: workspace };
          event.currentTarget.setPointerCapture(event.pointerId);
        }} onPointerMove={event => {
          const value = drag.current;
          if (!value || value.pointer !== event.pointerId) return;
          if (!value.moved && Math.abs(event.clientX - value.x) < 6) return;
          value.moved = true; setDragging(value.id);
          const container = strip.current;
          if (!container) return;
          const bounds = container.getBoundingClientRect();
          if (event.clientX < bounds.left + 30) container.scrollLeft -= 18;
          else if (event.clientX > bounds.right - 30) container.scrollLeft += 18;
          const others = Array.from(container.querySelectorAll<HTMLElement>('.tab')).filter(row => row.dataset.tabId !== value.id);
          value.index = others.filter(row => { const rect = row.getBoundingClientRect(); return event.clientX > rect.left + rect.width / 2; }).length;
          setPreview(moveWorkspaceTab(value.base, value.id, value.index));
        }} onPointerUp={() => finish(true)} onPointerCancel={() => finish(false)} onLostPointerCapture={() => finish(false)}
        onKeyDown={event => {
          if (event.key === 'Escape' && drag.current) { finish(false); return; }
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
      <button className="tab-close" disabled={disabled} aria-label={t('closeTab', { title: label(tab) })} onClick={() => close(tab.id)}>×</button>
    </div>)}
  </div>;
}
