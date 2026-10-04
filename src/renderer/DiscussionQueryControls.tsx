import { sameQuery } from '../domain/discussion-query';
import type { DiscussionQuery, SearchField } from '../domain/discussion-query';
import type { DiscussionViewState } from './discussion-view-session';
import { countLabel, translator } from './i18n';
import type { Locale } from './i18n';

export function DiscussionQueryControls({ state, locale, edit, apply, navigate, unseenCount }: {
  state: DiscussionViewState; locale: Locale; edit: (query: DiscussionQuery) => void; apply: () => void;
  navigate: (kind: 'match' | 'unseen', direction: 1 | -1) => void; unseenCount: number;
}) {
  const t = translator(locale), draft = state.draft;
  const position = state.selected ? state.result.orderedMatchIds.indexOf(state.selected) + 1 : 0;
  const errorKey = state.error === 'INVALID_REGEX' ? 'queryInvalidRegex' : state.error === 'NO_SEARCH_FIELDS' ? 'queryNoFields'
    : state.error === 'QUERY_TOO_EXPENSIVE' ? 'queryTooExpensive' : 'queryFailed';
  return <div className="discussion-query">
    <form className="query-controls" onSubmit={event => { event.preventDefault(); apply(); }}>
      <label className="query-search">{t('searchDiscussion')}<input type="search" value={draft.text} spellCheck={false}
        onChange={event => edit({ ...draft, text: event.target.value })} /></label>
      <details className="query-fields"><summary>{t('searchFields')}</summary>
        <fieldset><legend>{t('searchFields')}</legend>{(['content', 'author', 'replied-to-author'] as const).map((field: SearchField) =>
          <label key={field}><input type="checkbox" checked={draft.fields.includes(field)} onChange={() => edit({ ...draft,
            fields: draft.fields.includes(field) ? draft.fields.filter(value => value !== field) : [...draft.fields, field] })} />
            {t(field === 'content' ? 'searchContent' : field === 'author' ? 'searchAuthor' : 'searchRepliedTo')}</label>)}</fieldset>
      </details>
      <label>{t('seenFilter')}<select value={draft.seen} onChange={event => edit({ ...draft, seen: event.target.value as DiscussionQuery['seen'] })}>
        <option value="all">{t('filterAll')}</option><option value="unseen">{t('filterUnseen')}</option><option value="seen">{t('filterSeen')}</option>
      </select></label>
      <button type="button" aria-label={t('caseSensitive')} title={t('caseSensitive')} aria-pressed={draft.caseSensitive}
        onClick={() => edit({ ...draft, caseSensitive: !draft.caseSensitive })}>Aa</button>
      <button type="button" aria-label={t('regexMode')} title={t('regexMode')} aria-pressed={draft.mode === 'regex'}
        onClick={() => edit({ ...draft, mode: draft.mode === 'regex' ? 'text' : 'regex' })}>.*</button>
      <button type="submit" title={t('applyHelp')}>{t('applyView')}</button>
    </form>
    <div className="query-status" aria-live="polite">
      {state.result.restrictive && <span className="applied-counts">{t('appliedCounts', { comments: countLabel(locale, 'matchingComments', state.result.matchCount), threads: countLabel(locale, 'containingThreads', state.result.threadCount) })}</span>}
      {!sameQuery(draft, state.applied) && <span>{t('queryDraftPending')}</span>}
      {state.seenStale && <span>{t('querySeenPending')}</span>}
      {state.pending && <span>{t('queryEvaluating')}</span>}
    </div>
    {state.error && state.error !== 'QUERY_CANCELLED' && <p className="query-error" role="alert">{t(errorKey)}</p>}
    <div className="query-navigation" role="group" aria-label={t('discussionNavigation')}>
      <button disabled={!state.result.orderedMatchIds.length} onClick={() => navigate('match', -1)}>{t('previousMatch')}</button>
      <button disabled={!state.result.orderedMatchIds.length} onClick={() => navigate('match', 1)}>{t('nextMatch')}</button>
      <span aria-label={t('matchPosition')}>{new Intl.NumberFormat(locale).format(position)} / {new Intl.NumberFormat(locale).format(state.result.orderedMatchIds.length)}</span>
      <button disabled={!unseenCount} onClick={() => navigate('unseen', -1)}>{t('previousUnseen')}</button>
      <button disabled={!unseenCount} onClick={() => navigate('unseen', 1)}>{t('nextUnseen')}</button>
    </div>
  </div>;
}
