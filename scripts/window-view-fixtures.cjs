// Main/test-only helpers. No application or preload capability is added.
const { randomUUID } = require('node:crypto');
const initialWindow = db => db.prepare('SELECT id FROM app_windows ORDER BY rowid LIMIT 1').get().id;
function viewId(state, itemId) {
  const value = Object.entries(state.viewInstances).find(([, view]) => view.itemId === itemId);
  if (!value) throw new Error('Missing owned discussion view: ' + itemId);
  return value[0];
}
// M4 exposes no duplicate UI. These existing single-view harnesses resolve the
// real tab identity from its item evidence, then exercise that exact instance.
const tabElement = itemId => `document.querySelector(${JSON.stringify(`[data-tab-item-id="${itemId}"] [role=tab]`)})`;
function placeDiscussion(db, itemId, position, windowId = initialWindow(db)) {
  const id = randomUUID();
  db.prepare("INSERT INTO tab_instances VALUES (?,?,'discussion',?)").run(id, windowId, itemId);
  db.prepare('INSERT INTO item_resume_view VALUES (?,?,?)').run(windowId, itemId, id);
  db.prepare("INSERT INTO window_tabs VALUES (?,?,'discussion',?)").run(windowId, id, position);
  return id;
}
function placeSingleton(db, kind, position, windowId = initialWindow(db)) {
  const existing = db.prepare('SELECT id FROM tab_instances WHERE owner_window_id=? AND kind=?').get(windowId,kind);
  const id = existing?.id ?? randomUUID();
  if (!existing) db.prepare('INSERT INTO tab_instances VALUES (?,?,?,NULL)').run(id,windowId,kind);
  db.prepare('INSERT INTO window_tabs VALUES (?,?,?,?)').run(windowId,id,kind,position);
  return id;
}
function activeTab(db, id, windowId = initialWindow(db)) { db.prepare('UPDATE app_windows SET active_tab_id=?,topology_revision=topology_revision+1 WHERE id=?').run(id, windowId); }
function seedPeerIdentity(windows, repository) {
  windows.setIdentityProvider(() => {
    if (!windows.size) return repository.initialWindowId();
    const id = repository.createPersistentWindow();
    for (const item of repository.bootstrap(['en']).items) repository.changeWorkspace('openStoredItem', item.id, undefined, id);
    // Match the original fixture's initial selection, without sharing placements.
    const first = repository.workspace(id).tabs[0];
    if (first) repository.changeWorkspace('activateTab', first.id, undefined, id);
    return id;
  });
}
module.exports = { viewId, tabElement, placeDiscussion, placeSingleton, activeTab, initialWindow, seedPeerIdentity };
