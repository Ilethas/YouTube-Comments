import { expect, it } from 'vitest';
import { isAcquisitionNotification, isCommentProgress } from './acquisition';
const progress = { operationId: 'safe-id', kind: 'acquire', sourceKind: 'youtube-video', stage: 'fetching', startedAt: 1, cancellable: true };
it('accepts only exact structured safe counts on video fetching notifications', () => {
  for (const comments of [{ fetched: 0 }, { fetched: 1755, estimatedTotal: 8721 }, { fetched: 2, estimatedTotal: 2 }]) {
    expect(isCommentProgress(comments)).toBe(true);
    expect(isAcquisitionNotification({ ...progress, comments })).toBe(true);
  }
  for (const comments of [null, [], {}, { fetched: -1 }, { fetched: 1.5 }, { fetched: Infinity }, { fetched: Number.MAX_SAFE_INTEGER + 1 },
    { fetched: '123' }, { fetched: 1, estimatedTotal: 0 }, { fetched: 10, estimatedTotal: 9 }, { fetched: 1, estimatedTotal: NaN },
    { fetched: 1, stderr: 'private' }, { fetched: 1, estimatedTotal: 2, text: 'comment text' }]) {
    expect(isCommentProgress(comments)).toBe(false);
    expect(isAcquisitionNotification({ ...progress, comments })).toBe(false);
  }
  for (const changes of [{ stage: 'processing' }, { stage: 'saving', cancellable: false }, { sourceKind: 'youtube-community-post' }, { pid: 1 }])
    expect(isAcquisitionNotification({ ...progress, ...changes, comments: { fetched: 1 } })).toBe(false);
});
