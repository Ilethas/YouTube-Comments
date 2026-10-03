import { expect, it } from 'vitest';
import { closeWorkspaceTab, discussionTab, moveWorkspaceTab, openWorkspaceTab } from './workspace';
import type { WorkspaceState, WorkspaceTab } from './workspace';

const library: WorkspaceTab = { id: 'library', kind: 'library' };
const settings: WorkspaceTab = { id: 'settings', kind: 'settings' };
const mixed: WorkspaceState = { tabs: [discussionTab('a'), library, discussionTab('b'), settings], activeTabId: 'library', revision: 7 };
it('singletons activate without duplicates and closed views append', () => {
  for (const tab of mixed.tabs) {
    const opened = openWorkspaceTab(mixed, tab);
    expect(opened.tabs).toEqual(mixed.tabs);
    expect(opened.activeTabId).toBe(tab.id);
    const reopened = openWorkspaceTab(closeWorkspaceTab(mixed, tab.id), tab);
    expect(reopened.tabs.at(-1)).toEqual(tab);
    expect(reopened.tabs).toHaveLength(4);
  }
});
it('mixed active neighbors choose right then left then empty; background preserves active', () => {
  expect(closeWorkspaceTab(mixed, 'library').activeTabId).toBe('discussion:b');
  expect(closeWorkspaceTab({ ...mixed, activeTabId: 'settings' }, 'settings').activeTabId).toBe('discussion:b');
  expect(closeWorkspaceTab(mixed, 'settings').activeTabId).toBe('library');
  expect(closeWorkspaceTab({ tabs: [library], activeTabId: 'library', revision: 0 }, 'library')).toEqual({ tabs: [], activeTabId: null, revision: 1 });
});
it.each([[0, 3], [3, 0], [1, 2], [2, 1]])('moves slot %i to %i retaining every identity and active', (from, to) => {
  const moved = moveWorkspaceTab(mixed, mixed.tabs[from].id, to);
  const expected = [...mixed.tabs]; expected.splice(to, 0, expected.splice(from, 1)[0]);
  expect(moved.tabs).toEqual(expected);
  expect(moved.activeTabId).toBe(mixed.activeTabId);
  expect(moved.revision).toBe(8);
  expect(new Set(moved.tabs.map(tab => tab.id)).size).toBe(4);
});
it('rejects missing identities and invalid final indexes; no-op does not churn revision', () => {
  for (const index of [-1, 4, 1.1, NaN, Infinity]) expect(() => moveWorkspaceTab(mixed, 'library', index)).toThrow();
  expect(() => moveWorkspaceTab(mixed, 'missing', 0)).toThrow();
  expect(moveWorkspaceTab(mixed, 'library', 1)).toBe(mixed);
});
