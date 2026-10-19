// Deterministic test-only storage. Never opens an existing or owner profile.
const assert = require('node:assert/strict');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const query = { text: '', fields: ['content'], mode: 'text', caseSensitive: false, seen: 'all', publication: { kind: 'all' }, discovery: 'all' };
const database = root => path.join(root, 'youtube-comments-development', 'reader.sqlite');
function seed(root, ReaderRepository, windowCount) {
  let repo = ReaderRepository.open(database(root)); repo.initializeDemo(); repo.close();
  const db = new DatabaseSync(database(root));
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE; PRAGMA defer_foreign_keys=ON');
  try {
    const item = db.prepare("SELECT * FROM content_items WHERE id='video-demo'").get();
    const comment = db.prepare("SELECT * FROM comments WHERE id='v1'").get();
    const attempt = db.prepare('SELECT * FROM extraction_attempts WHERE id=?').get(item.baseline_attempt_id);
    const writer = (table, template) => {
      const keys = Object.keys(template), statement = db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`);
      return row => statement.run(...keys.map(key => row[key]));
    };
    const addItem = writer('content_items', item), addComment = writer('comments', comment), addAttempt = writer('extraction_attempts', attempt);
    const state = db.prepare('INSERT INTO comment_state VALUES (?,?,0)');
    for (const [position, count] of [10000, 50000].entries()) {
      const itemId = `m91-${count}`, baseline = `${itemId}-baseline`;
      // Valid canonical video IDs, fictional content, no network.
      const sourceId = count === 10000 ? 'M91small001' : 'M91large001';
      const remote = JSON.parse(item.remote_json); remote.sourceId = sourceId;
      remote.title = { status: 'observed', value: `M9.1 ${count}` };
      addAttempt({ ...attempt, id: baseline, item_id: itemId, source_id: sourceId, backend: 'm91-synthetic', attempt_order: 0 });
      addItem({ ...item, id: itemId, source_id: sourceId, title: `M9.1 ${count}`, position: position + 2,
        baseline_discovery_id: baseline, baseline_attempt_id: baseline, remote_json: JSON.stringify(remote) });
      for (let i = 0; i < count; i++) {
        // 100-comment complete trees: a chain to depth 60, then broad siblings.
        const rootIndex = Math.floor(i / 100) * 100;
        const parent = i === rootIndex ? null : `${itemId}-${i - rootIndex <= 60 ? i - 1 : rootIndex}`;
        const id = `${itemId}-${i}`, evidence = JSON.parse(comment.remote_json);
        const text = `${i % 97 === 0 ? 'needle ' : ''}camera ${i}: ${'Synthetic discussion. Zażółć gęślą jaźń.\n'.repeat(1 + i % 5)}`;
        const published = new Date(Date.UTC(2026, 9, 1) + i * 1000).toISOString();
        evidence.sourceId = id; evidence.text = { status: 'observed', value: text };
        evidence.relationship = parent ? { kind: 'direct-parent', parentSourceId: parent } : { kind: 'top-level' };
        evidence.publication.instant = { status: 'observed', value: published };
        evidence.likeCount = { status: 'observed', value: i % 19 };
        // No image requests or owner-derived content in the fixture.
        evidence.author.avatarUrl = { status: 'unknown', reason: 'unavailable' };
        addComment({ ...comment, id, item_id: itemId, parent_id: parent, position: i, source_comment_id: id, text,
          published_at: published, like_count: i % 19, remote_json: JSON.stringify(evidence),
          first_discovery_id: baseline, first_attempt_id: baseline, last_attempt_id: baseline });
        state.run(id, Number(i % 3 === 0));
      }
    }
    db.exec("UPDATE preferences SET locale='en',appearance='light'; COMMIT");
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } catch (error) { db.exec('ROLLBACK'); throw error; } finally { db.close(); }
  repo = ReaderRepository.open(database(root));
  try {
    const windows = [repo.initialWindowId()];
    while (windows.length < windowCount) windows.push(repo.createPersistentWindow());
    for (const [index, windowId] of windows.entries()) {
      // Twelve independent views per window, only visited views evaluate.
      for (const count of [10000, 50000]) {
        repo.changeWorkspace('openStoredItem', `m91-${count}`, undefined, windowId);
        let id = repo.workspace(windowId).activeTabId;
        for (let n = 0; n < 5; n++) {
          const duplicated = repo.duplicateTab({ sourceViewId: id, expectedRevision: repo.workspace(windowId).revision, intentRevision: 0, collapseRevision: 0 }, windowId);
          id = duplicated.workspace.activeTabId;
        }
      }
      const tabs = repo.workspace(windowId).tabs.filter(t => t.kind === 'discussion' && t.itemId === (index % 2 ? 'm91-10000' : 'm91-50000'));
      const active = tabs[0].id;
      repo.saveDiscussionView({ viewId: active, expectedRevision: 0, draft: { ...query, text: '' }, applied: { ...query, seen: 'unseen' }, sort: 'original', anchor: { commentId: null, offset: 0 }, selected: null }, windowId);
      repo.changeWorkspace('activateTab', active, undefined, windowId);
    }
    return windows;
  } finally { repo.close(); }
}
module.exports = { seed, database, query };
