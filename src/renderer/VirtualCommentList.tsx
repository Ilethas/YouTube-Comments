import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';
import type { Comment } from '../domain/discussion';
import type { DiscussionViewResult } from '../domain/discussion-query';
import { CommentArticle, commentTargetId } from './CommentTree';
import { estimateReaderHeight, projectReaderRows, readerIndent, readerRailX } from './discussion-presentation';
import type { ReaderRow } from './discussion-presentation';
import type { DiscussionViewSession, ReaderScrollAnchor, ReaderScrollRequest } from './discussion-view-session';
import type { Locale } from './i18n';
import { recordRenderWork } from './render-work';

export const readerOverscan = 6;
// Small discussions retain their complete accessible reading surface. This ceiling
// is constant, never proportional to a large discussion's stored row count.
export const completeReaderLimit = 200;

interface Props {
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
export const VirtualCommentList = memo(function VirtualCommentList({ itemId, comments, result, selected, scrollRequest, session,
  locale, disabled, now, onToggle, overscan = readerOverscan }: Props) {
  const list = useRef<HTMLOListElement>(null);
  const presentation = useMemo(() => {
    recordRenderWork('forest', itemId);
    recordRenderWork('tree', itemId);
    return projectReaderRows(comments, result);
  }, [comments, result, itemId]);
  const { rows, indexById } = presentation;
  const [geometry, setGeometry] = useState({ width: 1000, margin: 0 });
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
    const panel = getScrollElement();
    if (!panel) return;
    if (panel.scrollTop < geometry.margin) return { offset: panel.scrollTop };
    const item = virtualizer.getVirtualItemForOffset(panel.scrollTop);
    return item && rows[item.index] ? { id: rows[item.index].id, offset: panel.scrollTop - item.start } : undefined;
  }, [getScrollElement, geometry.margin, virtualizer, rows]);
  const capture = useRef(captureAnchor); capture.current = captureAnchor;
  useLayoutEffect(() => session.attachReader(() => capture.current()), [session]);

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
      setGeometry(current => current.width === width && current.margin === margin ? current : { width, margin });
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
      const target = measurement.start + offset;
      virtualizer.scrollToOffset(target, { behavior: 'auto' });
      stable = Math.abs(target - previous) < .5 ? stable + 1 : 0;
      previous = target;
      if (stable < 3 && ++attempts < 120) frame = requestAnimationFrame(correct);
    };
    correct();
    return () => cancelAnimationFrame(frame);
  }

  // Language can alter wrapped badges/metadata, including cached offscreen rows.
  const previousLocale = useRef(locale);
  useLayoutEffect(() => {
    if (previousLocale.current === locale) return;
    previousLocale.current = locale;
    const anchor = capture.current();
    virtualizer.measure();
    // Rebuild the estimate coordinate cache before comparing DOM sizes against
    // it; otherwise unchanged boxes can compare equal to pre-invalidation sizes.
    virtualizer.getTotalSize();
    for (const element of virtualizer.elementsCache.values()) virtualizer.measureElement(element);
    const index = anchor?.id === undefined ? undefined : indexById.get(anchor.id);
    if (index !== undefined && anchor) return restoreMeasuredAnchor(index, anchor.offset);
  }, [locale, virtualizer, indexById]);
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
    const targetId = scrollRequest.id;
    const index = targetId === undefined ? undefined : indexById.get(targetId);
    if (index === undefined || targetId === undefined) { virtualizer.scrollToOffset(scrollRequest.offset ?? 0); return; }
    if (scrollRequest.offset !== undefined) return restoreMeasuredAnchor(index, scrollRequest.offset);
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
  }, [scrollRequest, indexById, virtualizer, getScrollElement]);
  const items = virtualizer.getVirtualItems();
  return <ol ref={list} className="comment-tree root-tree virtual-reader" data-row-count={rows.length} data-mounted-count={items.length}
    style={{ height: virtualizer.getTotalSize() }}
    onFocusCapture={event => setFocusedId(event.target.closest<HTMLElement>('[data-comment-id]')?.dataset.commentId)}
    onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusedId(undefined); }}>
    {items.map(item => {
      const row = rows[item.index];
      return <li key={row.id} ref={virtualizer.measureElement} data-index={item.index} data-comment-id={row.id} data-depth={row.depth}
        aria-posinset={item.index + 1} aria-setsize={rows.length}
        className="comment-branch virtual-comment" style={{ transform: `translateY(${item.start - geometry.margin}px)`, '--reader-indent': `${readerIndent(row.depth)}px` } as CSSProperties}>
        <ReaderRails row={row} />
        <CommentArticle comment={row.comment} role={row.role} rawHit={row.rawHit} hasChildren={row.hasChildren} selected={selected === row.id}
          locale={locale} now={now} disabled={disabled} onToggle={onToggle} />
      </li>;
    })}
  </ol>;
});
