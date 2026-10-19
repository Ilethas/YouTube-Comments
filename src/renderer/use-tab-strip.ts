import { useEffect, useRef, useState } from 'react';
import type { WorkspaceState } from '../domain/workspace';
import { TAB_DRAG_MIME, isDragToken } from '../shared/tab-transfer';
import type { DragTicket, TabTransferApi } from '../shared/tab-transfer';

interface Gesture {
  readonly generation: number; readonly id: string; readonly revision: number;
  phase: 'preparing' | 'ready' | 'dragging'; ticket?: DragTicket;
  startedAt?: number;
}
/** Native HTML owns the mouse gesture. No pointer capture, DOM reordering or
 * activation during preview. Async preparation must finish BEFORE dragstart. */
export function useTabStrip(workspace: WorkspaceState, disabled: boolean, move: (id: string, index: number) => void, api?: TabTransferApi) {
  const strip = useRef<HTMLDivElement>(null), gesture = useRef<Gesture>(), generation = useRef(0);
  const outstanding = useRef<string>(), hoverId = useRef<string>(), hoverSequence = useRef(0);
  const current = useRef({ workspace, disabled, move, api }); current.current = { workspace, disabled, move, api };
  const [dragging, setDragging] = useState<string>(), [insertion, setInsertion] = useState<string | null | undefined>();
  const [status, setStatus] = useState<'tabDragStarted' | 'tabDragInsert' | 'tabDragCancelled' | 'tabDragFinished'>();
  const suppressClick = useRef(false), frame = useRef<number>(), x = useRef<number>();
  const previewRevision = useRef<number>();
  const offerSequence = useRef(0);
  function clearPreview() { x.current = undefined; previewRevision.current = undefined; cancelAnimationFrame(frame.current ?? 0); frame.current = undefined; setInsertion(undefined); }
  function cancel() {
    const g = gesture.current; gesture.current = undefined; generation.current++; offerSequence.current++;
    if (g?.phase === 'dragging') { suppressClick.current = true; setStatus('tabDragCancelled'); }
    if (outstanding.current) void current.current.api?.cancel({ token: outstanding.current }).catch(() => undefined);
    outstanding.current = undefined; setDragging(undefined); clearPreview();
  }
  function slot(clientX: number): string | null {
    const rows = Array.from(strip.current?.querySelectorAll<HTMLElement>('.tab') ?? []).filter(row => row.dataset.tabId !== gesture.current?.id);
    return rows.find(row => { const r = row.getBoundingClientRect(); return clientX < r.left + r.width / 2; })?.dataset.tabId ?? null;
  }
  function project() { if (x.current !== undefined) setInsertion(slot(x.current)); }
  function autoScroll() {
    const owner = strip.current;
    if (!owner || x.current === undefined) return;
    const r = owner.getBoundingClientRect();
    const delta = x.current < r.left + 30 ? -18 : x.current > r.right - 30 ? 18 : 0;
    if (delta) { owner.scrollLeft += delta; project(); }
    frame.current = requestAnimationFrame(autoScroll);
  }
  useEffect(() => {
    const owner = strip.current;
    if (!owner) return;
    function wheel(event: WheelEvent) {
      if (!owner || event.ctrlKey || !event.cancelable) return;
      const max = owner.scrollWidth - owner.clientWidth; if (max <= 0) return;
      const axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const next = Math.max(0, Math.min(max, owner.scrollLeft + axis * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? owner.clientWidth : 1)));
      if (next === owner.scrollLeft) return;
      owner.scrollLeft = next; event.preventDefault(); project();
    }
    let nesting = 0, lastReport = -Infinity;
    const supported = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes(TAB_DRAG_MIME);
    const report = (inside: boolean) => {
      if (!hoverId.current) return;
      void current.current.api?.hoverDrag({ gestureId: hoverId.current, sequence: ++hoverSequence.current, inside }).catch(() => undefined);
      lastReport = performance.now();
    };
    const enter = (e: DragEvent) => { if (supported(e)) { nesting++; if (nesting === 1) report(true); } };
    const leave = (e: DragEvent) => { if (supported(e)) { nesting = Math.max(0, nesting - 1); if (!nesting) { report(false); clearPreview(); } } };
    const over = (e: DragEvent) => {
      if (!supported(e)) return;
      if (x.current !== undefined && e.target instanceof Node && !owner.contains(e.target)) clearPreview();
      if (performance.now() - lastReport > 250) report(true);
    };
    // Keep recent in-app termination evidence until the recipient offer reaches
    // main. Clearing it first can race the source's cross-process dragend IPC.
    const drop = (e: DragEvent) => { if (supported(e)) { nesting = 0; report(true); } };
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !hoverId.current && !gesture.current) return;
      // Only an actually delivered Escape is dependable. Peer Escape cancels the
      // source via authenticated hover correlation, without knowing its token.
      if (hoverId.current) void current.current.api?.hoverDrag({ gestureId: hoverId.current, sequence: ++hoverSequence.current, inside: false, cancel: true }).catch(() => undefined);
      e.preventDefault(); cancel();
    };
    const visibility = () => { if (document.visibilityState === 'hidden') cancel(); };
    owner.addEventListener('wheel', wheel, { passive: false });
    window.addEventListener('dragenter', enter, true); window.addEventListener('dragleave', leave, true);
    window.addEventListener('dragover', over, true); window.addEventListener('drop', drop, true);
    document.addEventListener('keydown', key, true); document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', cancel);
    const unsubscribe = api?.onEvent(event => {
      if (event.kind === 'offered' && event.token === outstanding.current) outstanding.current = undefined;
      if (event.kind === 'drag-started') { offerSequence.current++; hoverId.current = event.token; hoverSequence.current = 0; nesting = 0; lastReport = -Infinity; }
      if (event.kind === 'drag-cleared' && event.token === hoverId.current) { hoverId.current = undefined; nesting = 0; clearPreview(); setStatus(undefined); }
      if ((event.kind === 'cancelled' || event.kind === 'committed') && event.token === outstanding.current) {
        outstanding.current = undefined; gesture.current = undefined; setDragging(undefined); clearPreview();
        if (event.kind === 'cancelled') setStatus('tabDragCancelled');
      }
    });
    return () => {
      cancel(); unsubscribe?.(); owner.removeEventListener('wheel', wheel);
      window.removeEventListener('dragenter', enter, true); window.removeEventListener('dragleave', leave, true);
      window.removeEventListener('dragover', over, true); window.removeEventListener('drop', drop, true);
      document.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', cancel);
    };
  }, [api]);
  useEffect(() => { if (disabled || gesture.current && gesture.current.revision !== workspace.revision) cancel(); }, [workspace.revision, disabled]);
  return {
    strip, dragging, insertion, status, shown: workspace, suppressClick,
    newPress(event: React.PointerEvent) { if (event.button === 0) { cancel(); suppressClick.current = false; } },
    begin(id: string, _index: number, event: React.PointerEvent<HTMLElement>) {
      if (event.button !== 0 || event.isPrimary === false || event.pointerType && event.pointerType !== 'mouse' || disabled || !api) return;
      const rect = event.currentTarget.getBoundingClientRect();
      const g: Gesture = { generation: ++generation.current, id, revision: workspace.revision, phase: 'preparing' }; gesture.current = g;
      void api.prepareDrag({ tabId: id, expectedRevision: workspace.revision, hotspot: { x: Math.max(0, event.clientX - rect.left + 10), y: Math.max(0, event.clientY) } }).then(result => {
        if (!result.ok) { if (gesture.current === g) cancel(); return; }
        if (gesture.current !== g || g.generation !== generation.current || current.current.disabled || current.current.workspace.revision !== g.revision) { void api.cancel({ token: result.value.token }); return; }
        g.ticket = result.value; g.phase = 'ready'; outstanding.current = result.value.token;
      }, () => { if (gesture.current === g) cancel(); });
    },
    pointerUp() { if (gesture.current?.phase !== 'dragging') cancel(); },
    pointerCancel() { if (gesture.current?.phase !== 'dragging') cancel(); },
    dragStart(id: string, event: React.DragEvent) {
      const g = gesture.current;
      if (disabled || !g || g.id !== id || g.phase !== 'ready' || !g.ticket || !isDragToken(g.ticket.token) || g.revision !== workspace.revision) { event.preventDefault(); cancel(); return; }
      try {
        event.dataTransfer.clearData(); event.dataTransfer.setData(TAB_DRAG_MIME, g.ticket.token); event.dataTransfer.effectAllowed = 'move';
        g.phase = 'dragging'; g.startedAt = event.timeStamp; suppressClick.current = true; setDragging(id); setStatus('tabDragStarted');
        void api?.startDrag({ token: g.ticket.token }).then(result => { if (!result.ok && gesture.current === g) cancel(); }, () => { if (gesture.current === g) cancel(); });
      } catch { event.preventDefault(); cancel(); }
    },
    dragOver(event: React.DragEvent) {
      if (disabled || document.visibilityState === 'hidden' || !Array.from(event.dataTransfer.types).includes(TAB_DRAG_MIME) || !hoverId.current && gesture.current?.phase !== 'dragging') return;
      event.preventDefault(); event.dataTransfer.dropEffect = 'move'; x.current = event.clientX;
      if (insertion === undefined) { previewRevision.current = workspace.revision; setStatus('tabDragInsert'); }
      project(); if (frame.current === undefined) frame.current = requestAnimationFrame(autoScroll);
    },
    dragLeave(event: React.DragEvent) {
      if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) clearPreview();
    },
    drop(event: React.DragEvent) {
      if (disabled || document.visibilityState === 'hidden' || !Array.from(event.dataTransfer.types).includes(TAB_DRAG_MIME)) return;
      const token = event.dataTransfer.getData(TAB_DRAG_MIME);
      if (!isDragToken(token)) { clearPreview(); return; }
      event.preventDefault(); const beforeTabId = slot(event.clientX), revision = previewRevision.current ?? workspace.revision; clearPreview();
      const g = gesture.current;
      if (g?.phase === 'dragging' && g.ticket?.token === token) {
        // Local reorder uses its existing CAS lane, never the transfer path.
        const others = workspace.tabs.filter(t => t.id !== g.id), index = beforeTabId === null ? others.length : others.findIndex(t => t.id === beforeTabId);
        outstanding.current = undefined; gesture.current = undefined; setDragging(undefined);
        void api?.endDrag({ token, outcome: 'local' }).then(result => {
          if (generation.current !== g.generation) return;
          const currentState = current.current;
          if (!result.ok) { setStatus('tabDragCancelled'); return; }
          if (!currentState.disabled && revision === currentState.workspace.revision && g.revision === currentState.workspace.revision && index >= 0
            && currentState.workspace.tabs.findIndex(t => t.id === g.id) !== index) currentState.move(g.id, index);
          setStatus('tabDragFinished');
        }, () => { if (generation.current === g.generation) setStatus('tabDragCancelled'); });
      } else {
        const sequence = ++offerSequence.current;
        const failed = () => { if (offerSequence.current === sequence) setStatus('tabDragCancelled'); };
        void api?.offerDrag({ token, expectedRevision: revision, beforeTabId }).then(result => { if (!result.ok) failed(); }, failed);
      }
    },
    dragEnd(event: React.DragEvent) {
      const g = gesture.current; if (g?.phase !== 'dragging' || !g.ticket) return;
      if (event.timeStamp < (g.startedAt ?? 0) || !(event.target instanceof Element) || event.target.closest('[role=tab]')?.id !== `tab-${g.id}`) return;
      // Dragend may expose no readable data. When a wrapper does provide a token,
      // a delayed old store cannot terminate the current native gesture.
      const exposed = event.dataTransfer.getData(TAB_DRAG_MIME);
      if (exposed && exposed !== g.ticket.token) return;
      gesture.current = undefined; setDragging(undefined); clearPreview();
      void api?.endDrag({ token: g.ticket.token, outcome: 'unclaimed' }).catch(() => undefined);
    },
  };
}
