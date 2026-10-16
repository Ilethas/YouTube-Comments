import type { OpenCommentAction } from './CommentActions';
import type { CommentMenuTarget } from './CommentContextMenu';
import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { Comment } from '../domain/discussion';
import type { DiscussionViewResult } from '../domain/discussion-query';
import { CommentArticle, commentTargetId } from './CommentTree';
import { estimateReaderHeight, readerIndent, readerRailX } from './discussion-presentation';
import type { ReaderRow } from './discussion-presentation';
import type { DiscussionViewSession, ReaderScrollAnchor, ReaderScrollRequest } from './discussion-view-session';
import type { Locale } from './i18n';
import { recordRenderWork } from './render-work';
import { DiscussionRuler } from './DiscussionRuler';
import { aggregateRulerMarkers, indexRulerMarkers, projectRulerMarkers } from './discussion-ruler';
import { scrollSaveDelay } from './discussion-view-save-queue';

export const readerOverscan = 6;
// Small discussions retain their complete accessible reading surface. This ceiling
// is constant, never proportional to a large discussion's stored row count.
export const completeReaderLimit = 200;
const noNewIds: ReadonlySet<string> = new Set();

interface Props {
  isDemo?: boolean;
  showSelection?: boolean;
  bulkSelected?: ReadonlySet<string>;
  onContextMenu?: (target: CommentMenuTarget) => void;
  onAction?: OpenCommentAction;
  itemId: string;
  comments: readonly Comment[];
  result: DiscussionViewResult;
  selected?: string;
  scrollRequest?: ReaderScrollRequest;
  session: DiscussionViewSession;
  locale: Locale;
  disabled: boolean;
  now: number;
  onToggle: (id: string, subtree: boolean) => void;
  overscan?: number;
  newIds?: ReadonlySet<string>;
}

/** Draw ancestry from data; parent articles need not be mounted. Coalescing
 * compact coincident rails bounds visual work without discarding actual depth. */
export function ReaderRails({ row }: { row: ReaderRow }) {
  const continuations = new Set<number>();
  for (let ancestor = row.ancestors; ancestor; ancestor = ancestor.parent) {
    if (ancestor.depth > 0 && ancestor.continues) continuations.add(readerRailX(ancestor.depth));
  }
  const parentX = readerRailX(row.depth);
  return <div className="reader-rails" aria-hidden="true">
    {[...continuations].map(left => <span key={left} className="ancestor-rail" style={{ left }} />)}
    {row.depth > 0 && <><span className="parent-rail" data-last={row.lastSibling} style={{ left: parentX }} />
      <span className="flat-elbow" style={{ left: parentX, width: Math.max(0, readerIndent(row.depth) - parentX) }} /></>}
    {row.depth >= 5 && row.firstSibling && <span className="compact-return" style={{ left: parentX, width: 22 }} />}
    {row.hasChildren && <span className="child-rail" style={{ left: readerIndent(row.depth) + 22 }} />}
  </div>;
}

/** Renderer-only geometry over complete application-data membership. Header and
 * query controls share the existing panel scrollbar, outside this measured list. */
export const VirtualCommentList = memo(function VirtualCommentList({ isDemo = false, showSelection = false, bulkSelected = noNewIds, onContextMenu, itemId, comments, result, selected, scrollRequest, session,
  locale, disabled, now, onToggle, onAction, overscan = readerOverscan, newIds = noNewIds }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const sort = session.state.sort;
  const collapse = session.state.collapse;
  const presentation = useMemo(() => {
    recordRenderWork('forest', itemId);
    recordRenderWork('tree', itemId);
    return session.displayed(comments);
  }, [comments, result, sort, collapse, session, itemId]);
  const { rows, indexById } = presentation;
  const toggleCollapse = useCallback((id: string) => {
    const state = session.state.collapse;
    session.setCollapsed({ kind: 'comments', ids: [id], collapsed: state.defaultCollapsed === state.overrides.includes(id) });
  }, [session]);
  const selectBulk = useCallback((id: string, shift: boolean) => session.toggleBulk(id, shift), [session]);
  function openMenu(id: string, element: HTMLElement, x: number, y: number) {
    const origin = element.querySelector<HTMLElement>('article') ?? element;
    const selection = document.getSelection();
    onContextMenu?.({ id, origin, x, y, selectionText: selection?.toString() ?? '',
      selectionRanges: selection ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange()) : [] });
  }
  const [geometry, setGeometry] = useState({ width: 1000, margin: 0, after: 0, top: 0, left: 0, height: 600 });
  const [focusedId, setFocusedId] = useState<string>();
  const getScrollElement = useCallback(() => list.current?.closest<HTMLElement>('.reader-panel') ?? null, []);
  const getItemKey = useCallback((index: number) => rows[index].id, [rows]);
  const estimateSize = useCallback((index: number) => estimateReaderHeight(rows[index], geometry.width), [rows, geometry.width]);
  const focusedIndex = focusedId === undefined ? undefined : indexById.get(focusedId);
  const rangeExtractor = useCallback((range: Parameters<typeof defaultRangeExtractor>[0]) => {
    const indexes = range.count <= completeReaderLimit ? Array.from({ length: range.count }, (_, i) => i) : defaultRangeExtractor(range);
    if (focusedIndex !== undefined && !indexes.includes(focusedIndex)) indexes.push(focusedIndex);
    return indexes.sort((a, b) => a - b);
  }, [focusedIndex]);
  const virtualizer = useVirtualizer<HTMLElement, HTMLLIElement>({ count: rows.length, getScrollElement, getItemKey, estimateSize,
    overscan, scrollMargin: geometry.margin, rangeExtractor, initialRect: { width: 1000, height: 600 },
    // Hidden panels keep their last viewport/cache. Showing an unrelated panel
    // must not reset or rebuild every hidden discussion's virtual range.
    observeElementRect: (instance, callback) => {
      const panel = instance.scrollElement;
      if (!panel) return;
      let previous = { width: -1, height: -1 };
      const update = () => {
        const rect = { width: panel.clientWidth, height: panel.clientHeight };
        if (!rect.width || !rect.height || (rect.width === previous.width && rect.height === previous.height)) return;
        previous = rect; callback(rect);
      };
      update();
      const observer = new ResizeObserver(update); observer.observe(panel);
      return () => observer.disconnect();
    },
    measureElement: (element, entry, instance) => {
      // Never replace a useful measured height with display:none's zero.
      const size = entry?.borderBoxSize?.[0]?.blockSize ?? element.getBoundingClientRect().height;
      const index = Number(element.dataset.index);
      return size > 0 ? size : instance.measurementsCache[index]?.size ?? estimateSize(index);
    },
  });
  const captureAnchor = useCallback((): ReaderScrollAnchor | undefined => {
    const panel = getScrollElement(), element = list.current;
    if (!panel || !element) return;
    // Query status/header reflow can precede ResizeObserver. Translate the known
    // list origin into cached virtual coordinates before resolving identity;
    // never discover targets by scanning mounted rows.
    const rect = element.getBoundingClientRect();
    const margin = rect.width > 0 && panel.clientHeight > 0
      ? rect.top - panel.getBoundingClientRect().top + panel.scrollTop : geometry.margin;
    if (panel.scrollTop < margin) return { offset: panel.scrollTop };
    const shift = margin - geometry.margin;
    const item = virtualizer.getVirtualItemForOffset(panel.scrollTop - shift);
    return item && rows[item.index] ? { id: rows[item.index].id, offset: panel.scrollTop - item.start - shift } : undefined;
  }, [getScrollElement, geometry.margin, virtualizer, rows]);
  const capture = useRef(captureAnchor); capture.current = captureAnchor;
  useLayoutEffect(() => session.attachReader(() => capture.current()), [session]);
  useLayoutEffect(() => {
    const panel = getScrollElement();
    if (!panel) return;
    let timer: ReturnType<typeof setTimeout>;
    const idle = () => { clearTimeout(timer); timer = setTimeout(() => session.readerSettled(), scrollSaveDelay); };
    panel.addEventListener('scroll', idle, { passive: true });
    // Explicit reveal may already be at its destination and emit no scroll event.
    idle();
    return () => { clearTimeout(timer); panel.removeEventListener('scroll', idle); };
  }, [session, getScrollElement, scrollRequest?.revision]);

  const pendingAnchor = useRef<ReaderScrollAnchor>();
  const previousWidth = useRef(0);
  useLayoutEffect(() => {
    const panel = getScrollElement(), element = list.current;
    if (!panel || !element) return;
    const update = () => {
      const width = element.getBoundingClientRect().width;
      if (!width || !panel.clientHeight) return;
      const margin = element.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
      if (previousWidth.current && previousWidth.current !== width) pendingAnchor.current = capture.current();
      if (previousWidth.current !== width) { previousWidth.current = width; virtualizer.measure(); }
      const column = element.closest('.reading-column'), rect = panel.getBoundingClientRect();
      const next = { width, margin, after: Math.max(0, (column?.getBoundingClientRect().bottom ?? element.getBoundingClientRect().bottom) - element.getBoundingClientRect().bottom),
        top: rect.top + 2, left: rect.left + panel.clientWidth - 20, height: Math.max(0, panel.clientHeight - 4) };
      setGeometry(current => Object.keys(next).every(key => current[key as keyof typeof next] === next[key as keyof typeof next]) ? current : next);
    };
    update();
    const observer = new ResizeObserver(update);
    // Column covers description/query/status height changes above the list.
    const column = element.closest('.reading-column');
    observer.observe(element); if (column) observer.observe(column); observer.observe(panel);
    return () => observer.disconnect();
  }, [getScrollElement, virtualizer]);

  useLayoutEffect(() => {
    if (!pendingAnchor.current) return;
    const anchor = pendingAnchor.current; pendingAnchor.current = undefined;
    const index = anchor.id === undefined ? undefined : indexById.get(anchor.id);
    if (index === undefined) return;
    return restoreMeasuredAnchor(index, anchor.offset);
  }, [geometry.width, indexById, virtualizer]);

  // Anchor restoration differs from index centering: retain the intra-row offset
  // while estimates become actual heights. Reconcile only this resolved data row.
  function restoreMeasuredAnchor(index: number, offset: number): () => void {
    let frame = 0, previous = -1, stable = 0, attempts = 0;
    const correct = () => {
      const measurement = virtualizer.measurementsCache[index];
      if (!measurement) return;
      // A refreshed/rewrapped row can be shorter than when its offset was saved.
      // Keep the identity visible rather than spilling a corrupt/old offset into
      // a completely different conversation.
      const target = measurement.start + Math.max(0, Math.min(offset, Math.max(0, measurement.size - 1)));
      virtualizer.scrollToOffset(target, { behavior: 'auto' });
      stable = Math.abs(target - previous) < .5 ? stable + 1 : 0;
      previous = target;
      if (stable < 3 && ++attempts < 120) frame = requestAnimationFrame(correct);
    };
    correct();
    return () => cancelAnimationFrame(frame);
  }

  // Language can alter wrapped badges/metadata, including cached offscreen rows.
  const previousLayout = useRef({ locale, showSelection });
  useLayoutEffect(() => {
    if (previousLayout.current.locale === locale && previousLayout.current.showSelection === showSelection) return;
    previousLayout.current = { locale, showSelection };
    const anchor = capture.current();
    virtualizer.measure();
    // Rebuild the estimate coordinate cache before comparing DOM sizes against
    // it; otherwise unchanged boxes can compare equal to pre-invalidation sizes.
    virtualizer.getTotalSize();
    for (const element of virtualizer.elementsCache.values()) virtualizer.measureElement(element);
    const index = anchor?.id === undefined ? undefined : indexById.get(anchor.id);
    if (index !== undefined && anchor) return restoreMeasuredAnchor(index, anchor.offset);
  }, [locale, showSelection, virtualizer, indexById]);
  useLayoutEffect(() => {
    // Clearing the cache does not itself resize a DOM box. Rows whose height
    // stays unchanged during reflow may emit no ResizeObserver entry, so restore
    // their actual measurements explicitly before painting estimated positions.
    for (const element of virtualizer.elementsCache.values()) virtualizer.measureElement(element);
  }, [geometry.width, locale, virtualizer]);
  useLayoutEffect(() => {
    if (focusedId === undefined || indexById.has(focusedId)) return;
    // Explicit Apply can remove the focused row. Return focus to its reader
    // rather than leave keyboard navigation on the document body.
    setFocusedId(undefined);
    getScrollElement()?.focus({ preventScroll: true });
  }, [focusedId, indexById, getScrollElement]);
  const handledRequest = useRef<number>();
  useLayoutEffect(() => {
    if (!scrollRequest || handledRequest.current === scrollRequest.revision) return;
    handledRequest.current = scrollRequest.revision;
    const panel = getScrollElement();
    if (!panel) return;
    const targetId = scrollRequest.id === undefined ? undefined : presentation.representativeById.get(scrollRequest.id);
    const index = targetId === undefined ? undefined : indexById.get(targetId);
    if (index === undefined || targetId === undefined) { virtualizer.scrollToOffset(scrollRequest.offset ?? 0); return; }
    if (scrollRequest.offset !== undefined) return restoreMeasuredAnchor(index, targetId === scrollRequest.id ? scrollRequest.offset : 0);
    virtualizer.scrollToIndex(index, { align: 'center', behavior: 'auto' });
    // The library reconciles estimated index scrolling as measured rows mount.
    // Final lookup is for this exact already-resolved ID, never target discovery.
    let frame = 0, attempts = 0;
    const finish = () => {
      const article = document.getElementById(commentTargetId(targetId));
      if (!article) { if (++attempts < 120) frame = requestAnimationFrame(finish); return; }
      if (scrollRequest.kind === 'navigate') {
        article.scrollIntoView({ block: 'center', behavior: 'auto' });
        article.focus({ preventScroll: true });
      }
    };
    frame = requestAnimationFrame(finish);
    return () => cancelAnimationFrame(frame);
  }, [scrollRequest, indexById, presentation, virtualizer, getScrollElement]);
  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const measurements = virtualizer.measurementsCache;
  const markers = useMemo(() => projectRulerMarkers(session.presentation(comments).rows, result, newIds, presentation), [presentation, comments, session, result, newIds]);
  const markerIndex = useMemo(() => indexRulerMarkers(markers), [markers]);
  const contentHeight = Math.max(geometry.height + 4, geometry.margin + totalSize + geometry.after);
  const buckets = useMemo(() => aggregateRulerMarkers(markerIndex, measurements, contentHeight, geometry.height), [markerIndex, measurements, contentHeight, geometry.height]);
  const panel = getScrollElement();
  return <><ol ref={list} className="comment-tree root-tree virtual-reader" data-row-count={rows.length} data-mounted-count={items.length}
    style={{ height: totalSize }}
    onFocusCapture={event => setFocusedId(event.target.closest<HTMLElement>('[data-comment-id]')?.dataset.commentId)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(undefined); }}>
    {items.map(item => {
      const row = rows[item.index];
      return <li key={row.id} ref={virtualizer.measureElement} data-index={item.index} data-comment-id={row.id} data-depth={row.depth}
        onContextMenu={event => {
          if (!onContextMenu) return;
          event.preventDefault(); event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu(row.id, event.currentTarget, event.clientX || rect.left + 24, event.clientY || rect.top + 24);
        }}
        onKeyDown={event => {
          if (!onContextMenu || !(event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey)) return;
          event.preventDefault(); event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect(); openMenu(row.id, event.currentTarget, rect.left + 24, rect.top + 24);
        }}
        aria-posinset={item.index + 1} aria-setsize={rows.length}
        className="comment-branch virtual-comment" style={{ transform: `translateY(${item.start - geometry.margin}px)`, '--reader-indent': `${readerIndent(row.depth)}px` } as CSSProperties}>
        <ReaderRails row={presentation.collapsed.has(row.id) ? { ...row, hasChildren: false } : row} />
        <CommentArticle comment={row.comment} role={row.role} rawHit={row.rawHit} hasChildren={row.hasChildren} selected={selected === row.id}
          showSelection={showSelection} bulkSelected={bulkSelected.has(row.id)} onSelect={selectBulk}
          descendantCount={presentation.summaries.get(row.id)?.descendants} hiddenUnseen={presentation.collapsed.has(row.id) ? presentation.summaries.get(row.id)?.unseen : 0} hiddenMatches={presentation.collapsed.has(row.id) ? presentation.summaries.get(row.id)?.matches : 0} collapsed={presentation.collapsed.has(row.id)}
          onCollapse={toggleCollapse}
          locale={locale} now={now} disabled={disabled} onToggle={onToggle} onAction={onAction} isNew={newIds.has(row.id)} isDemo={isDemo} />
      </li>;
    })}
  </ol>{panel && createPortal(<DiscussionRuler buckets={buckets} height={geometry.height} top={geometry.top} left={geometry.left}
    locale={locale} navigate={id => session.select(id)} />, panel)}</>;
});
