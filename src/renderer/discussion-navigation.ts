import type { Comment } from '../domain/discussion';
import { navigationTarget, visibleUnseenIds } from '../domain/discussion-query';
import { commentTargetId } from './CommentTree';
import type { DiscussionViewSession } from './discussion-view-session';

/** Resolve identity from application data before asking the DOM to reveal it. */
export function navigateDiscussion(session: DiscussionViewSession, comments: readonly Comment[], kind: 'match' | 'unseen', direction: 1 | -1): void {
  const { result, selected } = session.state;
  const candidates = kind === 'match' ? result.orderedMatchIds : visibleUnseenIds(result, comments);
  const id = navigationTarget(result.visibleCommentIds, candidates, selected, direction);
  if (!id) return;
  session.select(id);
  document.getElementById(commentTargetId(id))?.scrollIntoView({ block: 'center', behavior: 'auto' });
}
