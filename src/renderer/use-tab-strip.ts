import { useEffect, useRef, useState } from 'react';
import type { WorkspaceState } from '../domain/workspace';
import { moveWorkspaceTab } from '../domain/workspace';

interface Drag {
  id: string;
  startX: number;
  startY: number;
  x: number;
  pointer: number;
  moved: boolean;
  index: number;
  base: WorkspaceState;
}

/** Stable strip owns capture throughout preview reordering. Only a matching
 * primary release commits; cancellation and stale workspace revisions never do. */
export function useTabStrip(workspace: WorkspaceState, disabled: boolean, move: (id: string, index: number) => void, activate: (id: string) => void) {
  const strip = useRef<HTMLDivElement>(null);
  const drag = useRef<Drag>();
  const current = useRef({ workspace, disabled, move, activate });
  current.current = { workspace, disabled, move, activate };
  const [preview, setPreview] = useState<WorkspaceState>();
  const [dragging, setDragging] = useState<string>();
  const suppressClick = useRef(false);
  const frame = useRef<number>();
  function finish(commit: boolean) {
    const value = drag.current;
    if (!value) return;
    drag.current = undefined;
    cancelAnimationFrame(frame.current ?? 0);
    frame.current = undefined;
    const owner = strip.current;
    // Clear ownership before release generates lostpointercapture.
    if (owner?.hasPointerCapture(value.pointer)) owner.releasePointerCapture(value.pointer);
    setDragging(undefined); setPreview(undefined);
    if (value.moved) {
      suppressClick.current = true;
      if (commit && !current.current.disabled && value.base.revision === current.current.workspace.revision) current.current.move(value.id, value.index);
    } else if (commit && !current.current.disabled) {
      // Capture retargets pointer-up/click to the strip; preserve ordinary activation once.
      suppressClick.current = true; current.current.activate(value.id);
    }
  }
  function project() {
    const value = drag.current, owner = strip.current;
    if (!value?.moved || !owner) return;
    const others = Array.from(owner.querySelectorAll<HTMLElement>('.tab')).filter(row => row.dataset.tabId !== value.id);
    const index = others.filter(row => { const rect = row.getBoundingClientRect(); return value.x > rect.left + rect.width / 2; }).length;
    if (index !== value.index) {
      value.index = index;
      setPreview(moveWorkspaceTab(value.base, value.id, index));
    }
  }
  function autoScroll() {
    const value = drag.current, owner = strip.current;
    if (!value?.moved || !owner) return;
    const bounds = owner.getBoundingClientRect();
    const delta = value.x < bounds.left + 30 ? -18 : value.x > bounds.right - 30 ? 18 : 0;
    if (delta) { owner.scrollLeft += delta; project(); }
    frame.current = requestAnimationFrame(autoScroll);
  }
  useEffect(() => {
    const owner = strip.current;
    if (!owner) return;
    function wheel(event: WheelEvent) {
      if (!owner || event.ctrlKey || !event.cancelable) return;
      const max = owner.scrollWidth - owner.clientWidth;
      if (max <= 0) return;
      const axis = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const delta = axis * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? owner.clientWidth : 1);
      const before = owner.scrollLeft;
      const next = Math.max(0, Math.min(max, before + delta));
      if (next === before) return;
      owner.scrollLeft = next;
      if (owner.scrollLeft !== before) { event.preventDefault(); project(); }
    }
    const cancel = () => finish(false);
    const keyboard = (event: KeyboardEvent) => { if (event.key === 'Escape' && drag.current) { event.preventDefault(); cancel(); } };
    const visibility = () => { if (document.visibilityState === 'hidden') cancel(); };
    owner.addEventListener('wheel', wheel, { passive: false });
    document.addEventListener('keydown', keyboard);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', cancel);
    window.addEventListener('pagehide', cancel);
    return () => {
      cancel();
      owner.removeEventListener('wheel', wheel);
      document.removeEventListener('keydown', keyboard);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', cancel);
      window.removeEventListener('pagehide', cancel);
    };
  }, []);
  useEffect(() => {
    if (drag.current && (disabled || drag.current.base.revision !== workspace.revision)) finish(false);
  }, [workspace.revision, disabled]);
  return {
    strip, dragging, shown: preview && drag.current?.base.revision === workspace.revision ? preview : workspace,
    suppressClick,
    newPress(event: React.PointerEvent) { if (!drag.current && event.button === 0) suppressClick.current = false; },
    begin(id: string, index: number, event: React.PointerEvent) {
      if (event.button !== 0 || event.isPrimary === false || disabled || drag.current) return;
      // Keep suppression through a delayed release after Escape/cancellation.
      // A fresh press starts a new gesture; keyboard clicks remain independent.
      suppressClick.current = false;
      drag.current = { id, startX: event.clientX, startY: event.clientY, x: event.clientX, pointer: event.pointerId, moved: false, index, base: workspace };
      strip.current?.setPointerCapture(event.pointerId);
    },
    pointerMove(event: React.PointerEvent) {
      const value = drag.current;
      if (!value || value.pointer !== event.pointerId) return;
      value.x = event.clientX;
      if (!value.moved && Math.hypot(event.clientX - value.startX, event.clientY - value.startY) < 6) return;
      if (!value.moved) { value.moved = true; setDragging(value.id); frame.current = requestAnimationFrame(autoScroll); }
      project();
    },
    pointerUp(event: React.PointerEvent) { if (event.button === 0 && drag.current?.pointer === event.pointerId) finish(true); },
    pointerCancel(event: React.PointerEvent) { if (drag.current?.pointer === event.pointerId) finish(false); },
    lostCapture(event: React.PointerEvent) { if (event.target === strip.current && drag.current?.pointer === event.pointerId) finish(false); },
  };
}
