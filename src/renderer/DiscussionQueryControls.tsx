import { ActionIcon } from './ActionIcon';
import { useId, useState } from 'react';
import { sameQuery } from '../domain/discussion-query';
import type { DiscussionQuery, SearchField } from '../domain/discussion-query';
import type { PublicationCriteria } from '../domain/publication-filter';
import type { DiscussionViewState } from './discussion-view-session';
import { countLabel, translator } from './i18n';
import type { Locale } from './i18n';
import { shortcutHint } from './shortcuts';
import { discussionSorts } from './discussion-sort';
import type { DiscussionSort } from './discussion-sort';
import type { ReaderPresentation } from './discussion-presentation';
import { maxQueryTextLength } from '../domain/discussion-view';

const sortLabels = { original: 'sortOriginal', newest: 'sortNewest', oldest: 'sortOldest', 'most-liked': 'sortMostLiked', 'latest-activity': 'sortLatestActivity' } as const;
const sortHelp = { original: 'sortOriginalHelp', newest: 'sortPublicationHelp', oldest: 'sortPublicationHelp', 'most-liked': 'sortLikesHelp', 'latest-activity': 'sortActivityHelp' } as const;

export function DiscussionQueryControls({ setCollapsed, state, presentation, sort, locale, edit, apply, navigate, unseenCount }: {
  setCollapsed?: (collapsed: boolean) => void;
  state: DiscussionViewState; locale: Locale; edit: (query: DiscussionQuery) => void; apply: () => void;
  presentation: ReaderPresentation; sort: (sort: DiscussionSort) => void;
  navigate: (kind: 'match' | 'unseen', direction: 1 | -1) => void; unseenCount: number;
}) {
  const t = translator(locale), draft = state.draft;
  const sortHelpId = useId();
  const [nativeInvalid, setNativeInvalid] = useState(false);
  const position = state.selected ? presentation.orderedMatchIds.indexOf(state.selected) + 1 : 0;
  const custom = draft.publication.kind === 'custom' ? draft.publication : undefined;
  const customDisabled = draft.publication.kind !== 'all' && !custom;
  const invalidRange = !!(custom?.from && custom.to && (custom.from > custom.to
    || custom.from === custom.to && custom.fromTime && custom.toTime && custom.fromTime > custom.toTime));
  const publicationLabel = (criteria: PublicationCriteria) => t(criteria.kind === 'today' ? 'dateToday'
    : criteria.kind === 'last-24-hours' ? 'dateLast24Hours' : criteria.kind === 'last-7-days' ? 'dateLast7Days' : 'dateCustom');
  const appliedPublication = state.applied.publication;
  const publicationActive = appliedPublication.kind !== 'all' && (appliedPublication.kind !== 'custom' || !!(appliedPublication.from || appliedPublication.to));
  const errorKey = state.error === 'INVALID_REGEX' ? 'queryInvalidRegex' : state.error === 'NO_SEARCH_FIELDS' ? 'queryNoFields'
    : state.error === 'INVALID_PUBLICATION_RANGE' ? 'queryInvalidDateRange' : state.error === 'INVALID_PUBLICATION_DATE' ? 'queryInvalidDate'
    : state.error === 'INVALID_PUBLICATION_TIME' ? 'queryInvalidTime' : state.error === 'INVALID_LOCAL_TIME' ? 'bulkInvalidLocalTime'
    : state.error === 'QUERY_TOO_EXPENSIVE' ? 'queryTooExpensive' : 'queryFailed';
  return <div className="discussion-query">
    <form className="query-controls" onInvalid={() => setNativeInvalid(true)} onInput={() => setNativeInvalid(false)}
      onSubmit={event => { event.preventDefault(); setNativeInvalid(false); apply(); }}>
      <label className="query-search">{t('searchDiscussion')}<input type="search" value={draft.text} maxLength={maxQueryTextLength} spellCheck={false} title={shortcutHint(locale, 'focus-search', t('searchDiscussion'))}
        onChange={event => edit({ ...draft, text: event.target.value })} /></label>
      <details className="query-fields"><summary>{t('searchFields')}</summary>
        <fieldset><legend>{t('searchFields')}</legend>{(['content', 'author', 'replied-to-author'] as const).map((field: SearchField) =>
          <label key={field}><input type="checkbox" checked={draft.fields.includes(field)} onChange={() => edit({ ...draft,
            fields: draft.fields.includes(field) ? draft.fields.filter(value => value !== field) : [...draft.fields, field] })} />
            {t(field === 'content' ? 'searchContent' : field === 'author' ? 'searchAuthor' : 'searchRepliedTo')}</label>)}</fieldset>
      </details>
      <details className="query-fields query-dates"><summary>{t('dateAndDiscovery')}</summary>
        <fieldset><legend>{t('dateAndDiscovery')}</legend>
          <label>{t('publicationPreset')}<select name="publication-preset" value={draft.publication.kind === 'custom' ? 'all' : draft.publication.kind}
            onChange={event => edit({ ...draft, publication: { kind: event.target.value as 'all' | 'today' | 'last-24-hours' | 'last-7-days' } })}>
            <option value="all">{t('dateCustom')}</option><option value="today">{t('dateToday')}</option>
            <option value="last-24-hours">{t('dateLast24Hours')}</option><option value="last-7-days">{t('dateLast7Days')}</option>
          </select></label>
          <label title={customDisabled ? t('datePresetDisablesCustom') : undefined}>{t('dateFrom')}<input name="publication-from" type="date" min="0001-01-01" max="9999-12-31"
            disabled={customDisabled} value={custom?.from ?? ''} aria-invalid={invalidRange || undefined}
            onChange={event => edit({ ...draft, publication: { ...custom, kind: 'custom', from: event.target.value || undefined } })} /></label>
          <label>{t('bulkFromTime')}<input name="publication-fromTime" type="time" step="60" disabled={customDisabled} value={custom?.fromTime ?? ''}
            onChange={event => edit({ ...draft, publication: { ...custom, kind: 'custom', fromTime: event.target.value || undefined } })} /></label>
          <label title={customDisabled ? t('datePresetDisablesCustom') : undefined}>{t('dateTo')}<input name="publication-to" type="date" min="0001-01-01" max="9999-12-31"
            disabled={customDisabled} value={custom?.to ?? ''} aria-invalid={invalidRange || undefined}
            onChange={event => edit({ ...draft, publication: { ...custom, kind: 'custom', to: event.target.value || undefined } })} /></label>
          <label>{t('bulkToTime')}<input name="publication-toTime" type="time" step="60" disabled={customDisabled} value={custom?.toTime ?? ''}
            onChange={event => edit({ ...draft, publication: { ...custom, kind: 'custom', toTime: event.target.value || undefined } })} /></label>
          <small>{t('queryTimeHelp')}</small>
          {customDisabled && <small>{t('datePresetDisablesCustom')}</small>}
          <label>{t('discoveryFilter')}<select name="discovery" value={draft.discovery} onChange={event => edit({ ...draft, discovery: event.target.value as DiscussionQuery['discovery'] })}>
            <option value="all">{t('discoveryAll')}</option><option value="new">{t('discoveryNew')}</option>
          </select></label>
          <small title={t('publicationEstimateHelp')}>{t('publicationEstimateShort')}</small>
        </fieldset>
      </details>
      <label>{t('seenFilter')}<select name="seen" value={draft.seen} onChange={event => edit({ ...draft, seen: event.target.value as DiscussionQuery['seen'] })}>
        <option value="all">{t('filterAll')}</option><option value="unseen">{t('filterUnseen')}</option><option value="seen">{t('filterSeen')}</option>
      </select></label>
      <button type="button" aria-label={t('caseSensitive')} title={t('caseSensitive')} aria-pressed={draft.caseSensitive}
        onClick={() => edit({ ...draft, caseSensitive: !draft.caseSensitive })}>Aa</button>
      <button type="button" aria-label={t('regexMode')} title={t('regexMode')} aria-pressed={draft.mode === 'regex'}
        onClick={() => edit({ ...draft, mode: draft.mode === 'regex' ? 'text' : 'regex' })}>.*</button>
      <button type="submit" title={shortcutHint(locale, 'apply-view')}>{t('applyView')}</button>
    </form>
    <div className="discussion-sort">
      <label>{t('sortConversations')}<select value={state.sort} onChange={event => sort(event.target.value as DiscussionSort)}
        title={t(sortHelp[state.sort])} aria-describedby={!presentation.mostLikedAvailable ? sortHelpId : undefined}>
        {discussionSorts.map(mode => <option key={mode} value={mode} disabled={mode === 'most-liked' && !presentation.mostLikedAvailable}
          title={t(mode === 'most-liked' && !presentation.mostLikedAvailable ? 'sortLikesUnavailable' : sortHelp[mode])}>{t(sortLabels[mode])}</option>)}
      </select></label>
      {setCollapsed && <div className="expansion-controls" role="group" aria-label={t('threadExpansion')}>
        <button type="button" title={t('expandAll')} onClick={() => setCollapsed(false)}><ActionIcon name="expandAll" />{t('expandAll')}</button>
        <button type="button" title={t('collapseAll')} onClick={() => setCollapsed(true)}><ActionIcon name="collapseAll" />{t('collapseAll')}</button>
      </div>}
      {!presentation.mostLikedAvailable && <small id={sortHelpId}>{t('sortLikesUnavailable')}</small>}
    </div>
    <div className="query-status" aria-live="polite">
      {state.result.restrictive && <span className="applied-counts">{t('appliedCounts', { comments: countLabel(locale, 'matchingComments', state.result.matchCount), threads: countLabel(locale, 'containingThreads', state.result.threadCount) })}</span>}
      {publicationActive && <span>{t('appliedPublication', { range: appliedPublication.kind === 'custom'
        ? t('dateCustomRange', { from: `${appliedPublication.from ?? t('dateOpenBoundary')}${appliedPublication.fromTime ? ` ${appliedPublication.fromTime}` : ''}`, to: `${appliedPublication.to ?? t('dateOpenBoundary')}${appliedPublication.toTime ? ` ${appliedPublication.toTime}` : ''}` })
        : publicationLabel(appliedPublication) })}</span>}
      {state.applied.discovery === 'new' && <span>{t('discoveryNew')}</span>}
      {!sameQuery(draft, state.applied) && <span>{t('queryDraftPending')}</span>}
      {state.seenStale && <span>{t('querySeenPending')}</span>}
      {state.pending && <span>{t('queryEvaluating')}</span>}
    </div>
    {(nativeInvalid || invalidRange || (state.error && state.error !== 'QUERY_CANCELLED')) && <p className="query-error" role="alert">{t(nativeInvalid ? 'queryInvalidTime' : invalidRange ? 'queryInvalidDateRange' : errorKey)}</p>}
    <div className="query-navigation" role="group" aria-label={t('discussionNavigation')}>
      <button title={shortcutHint(locale, 'previous-match')} disabled={!presentation.orderedMatchIds.length} onClick={() => navigate('match', -1)}>{t('previousMatch')}</button>
      <button title={shortcutHint(locale, 'next-match')} disabled={!presentation.orderedMatchIds.length} onClick={() => navigate('match', 1)}>{t('nextMatch')}</button>
      <span aria-label={t('matchPosition')}>{new Intl.NumberFormat(locale).format(position)} / {new Intl.NumberFormat(locale).format(presentation.orderedMatchIds.length)}</span>
      <button disabled={!unseenCount} onClick={() => navigate('unseen', -1)}>{t('previousUnseen')}</button>
      <button disabled={!unseenCount} onClick={() => navigate('unseen', 1)}>{t('nextUnseen')}</button>
    </div>
  </div>;
}
