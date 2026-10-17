import type { ReaderRepository } from '../persistence/reader-repository';
import type { ToggleSeenRequest } from '../../shared/reader-api';
/** Existing sequential gesture fixtures read acknowledged state before assigning.
 * Concurrent M2 tests submit their captured explicit requests directly. */
export function displayedToggle(repo: ReaderRepository, request: Omit<ToggleSeenRequest, 'seen'>) {
  const seen = !repo.bootstrap(['en']).comments[request.itemId]?.find(c => c.id === request.commentId)?.seen;
  return repo.toggleSeen({ ...request, seen });
}
export function displayedUndo(repo: ReaderRepository, itemId: string) {
  const expectedOperationId = repo.bootstrap(['en']).seenUndo[itemId]?.id ?? 'missing-operation';
  return repo.undoSeen(itemId, expectedOperationId);
}
