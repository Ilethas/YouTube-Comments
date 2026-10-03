/** Open views are independent of the library. Revision orders acknowledgments from
 * acquisition and workspace operations; it is never a renderer mutation input. */
export interface WorkspaceState {
  readonly openItemIds: readonly string[];
  readonly activeItemId: string | null;
  readonly revision: number;
}

/** Closing an active view selects its right neighbor, then left, then empty.
 * Closing a background view never changes the active selection. */
export function closeWorkspaceTab(state: WorkspaceState, itemId: string): WorkspaceState {
  const index = state.openItemIds.indexOf(itemId);
  if (index < 0) return state;
  const openItemIds = state.openItemIds.filter(id => id !== itemId);
  return { openItemIds, activeItemId: state.activeItemId === itemId
    ? state.openItemIds[index + 1] ?? state.openItemIds[index - 1] ?? null : state.activeItemId,
  revision: state.revision + 1 };
}
