import type { Comment } from '../domain/discussion';
import { navigationTarget, visibleUnseenIds } from '../domain/discussion-query';
import type { DiscussionViewSession } from './discussion-view-session';

/** Resolve identity from complete application data; the mounted reader fulfills
 * the session's scroll intent by presentation index, even for an unmounted row. */
export function navigateDiscussion(session: DiscussionViewSession, comments: readonly Comment[], kind: 'match' | 'unseen', direction: 1 | -1): void {
  const { result, selected } = session.state;
  const candidates = kind === 'match' ? result.orderedMatchIds : visibleUnseenIds(result, comments);
  const id = navigationTarget(result.visibleCommentIds, candidates, selected, direction);
  if (!id) return;
  session.select(id);
}
