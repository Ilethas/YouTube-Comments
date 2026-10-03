/** Application-owned identities never depend on remote source IDs. */
export type WorkspaceTab =
  | { readonly id: string; readonly kind: 'discussion'; readonly itemId: string }
  | { readonly id: 'library' | 'settings'; readonly kind: 'library' | 'settings' };

/** Revision orders acknowledgments and is never a renderer mutation input. */
export interface WorkspaceState {
  readonly tabs: readonly WorkspaceTab[];
  readonly activeTabId: string | null;
  readonly revision: number;
}
export const discussionTab = (itemId: string): WorkspaceTab => ({ id: `discussion:${itemId}`, kind: 'discussion', itemId });
export class InvalidWorkspaceMoveError extends Error {}

/** Singleton open appends a closed view or activates an existing one. */
export function openWorkspaceTab(state: WorkspaceState, tab: WorkspaceTab): WorkspaceState {
  if (state.activeTabId === tab.id) return state;
  return { tabs: state.tabs.some(value => value.id === tab.id) ? state.tabs : [...state.tabs, tab],
    activeTabId: tab.id, revision: state.revision + 1 };
}

/** Closing active selects immediately right, then left, then empty. */
export function closeWorkspaceTab(state: WorkspaceState, tabId: string): WorkspaceState {
  const index = state.tabs.findIndex(tab => tab.id === tabId);
  if (index < 0) return state;
  return { tabs: state.tabs.filter(tab => tab.id !== tabId), activeTabId: state.activeTabId === tabId
    ? state.tabs[index + 1]?.id ?? state.tabs[index - 1]?.id ?? null : state.activeTabId,
  revision: state.revision + 1 };
}

/** Move to a final zero-based slot without changing active identity. */
export function moveWorkspaceTab(state: WorkspaceState, tabId: string, toIndex: number): WorkspaceState {
  const from = state.tabs.findIndex(tab => tab.id === tabId);
  if (from < 0 || !Number.isInteger(toIndex) || toIndex < 0 || toIndex >= state.tabs.length) throw new InvalidWorkspaceMoveError('Invalid tab/index');
  if (from === toIndex) return state;
  const tabs = [...state.tabs];
  tabs.splice(toIndex, 0, tabs.splice(from, 1)[0]);
  return { ...state, tabs, revision: state.revision + 1 };
}
