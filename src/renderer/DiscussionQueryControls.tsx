import { sameQuery } from '../domain/discussion-query';
import type { DiscussionQuery, SearchField } from '../domain/discussion-query';
import type { PublicationCriteria } from '../domain/publication-filter';
import type { DiscussionViewState } from './discussion-view-session';
import { countLabel, translator } from './i18n';
import type { Locale } from './i18n';
import { shortcutHint } from './shortcuts';

export function DiscussionQueryControls({ state, locale, edit, apply, navigate, unseenCount }: {
  state: DiscussionViewState; locale: Locale; edit: (query: DiscussionQuery) => void; apply: () => void;
  navigate: (kind: 'match' | 'unseen', direction: 1 | -1) => void; unseenCount: number;
}) {
  const t = translator(locale), draft = state.draft;
  const position = state.selected ? state.result.orderedMatchIds.indexOf(state.selected) + 1 : 0;
  const custom = draft.publication.kind === 'custom' ? draft.publication : undefined;
  const customDisabled = draft.publication.kind !== 'all' && !custom;
  const invalidRange = !!(custom?.from && custom.to && custom.from > custom.to);
  const publicationLabel = (criteria: PublicationCriteria) => t(criteria.kind === 'today' ? 'dateToday'
    : criteria.kind === 'last-24-hours' ? 'dateLast24Hours' : criteria.kind === 'last-7-days' ? 'dateLast7Days' : 'dateCustom');
  const appliedPublication = state.applied.publication;
  const publicationActive = appliedPublication.kind !== 'all' && (appliedPublication.kind !== 'custom' || !!(appliedPublication.from || appliedPublication.to));
  const errorKey = state.error === 'INVALID_REGEX' ? 'queryInvalidRegex' : state.error === 'NO_SEARCH_FIELDS' ? 'queryNoFields'
    : state.error === 'INVALID_PUBLICATION_RANGE' ? 'queryInvalidDateRange' : state.error === 'INVALID_PUBLICATION_DATE' ? 'queryInvalidDate'
    : state.error === 'QUERY_TOO_EXPENSIVE' ? 'queryTooExpensive' : 'queryFailed';
  return <div className="discussion-query">
    <form className="query-controls" onSubmit={event => { event.preventDefault(); apply(); }}>
      <label className="query-search">{t('searchDiscussion')}<input type="search" value={draft.text} spellCheck={false} title={shortcutHint(locale, 'focus-search', t('searchDiscussion'))}
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
            onChange={event => edit({ ...draft, publication: { kind: 'custom', from: event.target.value || undefined, to: custom?.to } })} /></label>
          <label title={customDisabled ? t('datePresetDisablesCustom') : undefined}>{t('dateTo')}<input name="publication-to" type="date" min="0001-01-01" max="9999-12-31"
            disabled={customDisabled} value={custom?.to ?? ''} aria-invalid={invalidRange || undefined}
            onChange={event => edit({ ...draft, publication: { kind: 'custom', from: custom?.from, to: event.target.value || undefined } })} /></label>
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
    <div className="query-status" aria-live="polite">
      {state.result.restrictive && <span className="applied-counts">{t('appliedCounts', { comments: countLabel(locale, 'matchingComments', state.result.matchCount), threads: countLabel(locale, 'containingThreads', state.result.threadCount) })}</span>}
      {publicationActive && <span>{t('appliedPublication', { range: appliedPublication.kind === 'custom'
        ? t('dateCustomRange', { from: appliedPublication.from ?? t('dateOpenBoundary'), to: appliedPublication.to ?? t('dateOpenBoundary') })
        : publicationLabel(appliedPublication) })}</span>}
      {state.applied.discovery === 'new' && <span>{t('discoveryNew')}</span>}
      {!sameQuery(draft, state.applied) && <span>{t('queryDraftPending')}</span>}
      {state.seenStale && <span>{t('querySeenPending')}</span>}
      {state.pending && <span>{t('queryEvaluating')}</span>}
    </div>
    {(invalidRange || (state.error && state.error !== 'QUERY_CANCELLED')) && <p className="query-error" role="alert">{t(invalidRange ? 'queryInvalidDateRange' : errorKey)}</p>}
    <div className="query-navigation" role="group" aria-label={t('discussionNavigation')}>
      <button title={shortcutHint(locale, 'previous-match')} disabled={!state.result.orderedMatchIds.length} onClick={() => navigate('match', -1)}>{t('previousMatch')}</button>
      <button title={shortcutHint(locale, 'next-match')} disabled={!state.result.orderedMatchIds.length} onClick={() => navigate('match', 1)}>{t('nextMatch')}</button>
      <span aria-label={t('matchPosition')}>{new Intl.NumberFormat(locale).format(position)} / {new Intl.NumberFormat(locale).format(state.result.orderedMatchIds.length)}</span>
      <button disabled={!unseenCount} onClick={() => navigate('unseen', -1)}>{t('previousUnseen')}</button>
      <button disabled={!unseenCount} onClick={() => navigate('unseen', 1)}>{t('nextUnseen')}</button>
    </div>
  </div>;
}
