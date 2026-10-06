import { useMemo, useState } from 'react';
import type { RulerBucket, RulerCategory } from './discussion-ruler';
import { rulerCategories, rulerLanePath, rulerTarget } from './discussion-ruler';
import { rulerBucketLabel, translator } from './i18n';
import type { Locale } from './i18n';

interface Props {
  buckets: readonly RulerBucket[];
  height: number;
  top: number;
  left: number;
  locale: Locale;
  navigate: (id: string) => void;
}

/** One keyboard stop and three aggregated lane paths, regardless of comment count.
 * Up/down choose occupied bands, left/right choose a lane, Enter/Space reveal. */
export function DiscussionRuler({ buckets, height, top, left, locale, navigate }: Props) {
  const [hover, setHover] = useState<number>();
  const [focused, setFocused] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [category, setCategory] = useState<RulerCategory>('unseen');
  const paths = useMemo(() => rulerCategories.map(lane => rulerLanePath(buckets, lane)), [buckets]);
  const counts = useMemo(() => rulerCategories.map(lane => buckets.reduce((total, bucket) => total + bucket.targets[lane].length, 0)), [buckets]);
  const current = buckets[Math.min(cursor, Math.max(0, buckets.length - 1))];
  const hovered = hover === undefined ? undefined : buckets.find(bucket => bucket.index === hover);
  const tooltip = hovered ?? (focused ? current : undefined);
  const t = translator(locale);
  const activate = (bucket: RulerBucket | undefined, lane: RulerCategory, coordinate: number) => {
    if (!bucket) return;
    const id = rulerTarget(bucket, lane, coordinate);
    if (id) navigate(id);
  };
  return <div className="discussion-ruler" role="button" tabIndex={buckets.length ? 0 : -1}
    aria-disabled={!buckets.length} aria-label={`${t('overviewRuler')}. ${t('rulerKeyboardHelp')}${focused && current ? `. ${t(category === 'unseen' ? 'unseen' : category === 'match' ? 'activeMatch' : 'new')}. ${rulerBucketLabel(locale, current)}` : ''}`}
    data-bucket-count={buckets.length} data-unseen-count={counts[0]} data-match-count={counts[1]} data-new-count={counts[2]} style={{ height, top, left }}
    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
    onPointerLeave={() => setHover(undefined)}
    onPointerMove={event => {
      const rect = event.currentTarget.getBoundingClientRect();
      setHover(Math.floor((event.clientY - rect.top) / 3));
    }}
    onClick={event => {
      const rect = event.currentTarget.getBoundingClientRect(), y = event.clientY - rect.top;
      const lane = rulerCategories[Math.max(0, Math.min(2, Math.floor((event.clientX - rect.left) / 6)))];
      const bucket = buckets.find(candidate => y >= candidate.top && y < candidate.top + candidate.height);
      activate(bucket, lane, y);
    }}
    onKeyDown={event => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.nativeEvent.isComposing) return;
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); setCursor(value => Math.max(0, Math.min(buckets.length - 1, value + (event.key === 'ArrowDown' ? 1 : -1))));
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault(); setCursor(event.key === 'Home' ? 0 : Math.max(0, buckets.length - 1));
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); setCategory(rulerCategories[(rulerCategories.indexOf(category) + (event.key === 'ArrowRight' ? 1 : 2)) % 3]);
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault(); activate(current, category, current ? current.top + current.height / 2 : 0);
      }
    }}>
    <svg viewBox={`0 0 18 ${Math.max(1, height)}`} preserveAspectRatio="none" aria-hidden="true">
      {rulerCategories.map((lane, index) => <path key={lane} className={`ruler-${lane}`} d={paths[index]} />)}
    </svg>
    {focused && current && <span aria-hidden="true" className="ruler-cursor" style={{ top: current.top, left: rulerCategories.indexOf(category) * 6 }} />}
    {tooltip && <span className="ruler-tooltip" role="tooltip" style={{ top: Math.min(tooltip.top, Math.max(0, height - 65)) }}>{rulerBucketLabel(locale, tooltip)}</span>}
  </div>;
}
