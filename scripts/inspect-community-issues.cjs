// Read-only development diagnostic. Prints structural issue patterns only, never content/IDs.
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const file = process.argv[2] ?? path.join(process.env.APPDATA, 'youtube-comments-development', 'reader.sqlite');
const db = new DatabaseSync(file, { readOnly: true });
try {
  console.log(JSON.stringify(db.prepare('SELECT backend, count(*) AS attempts FROM extraction_attempts GROUP BY backend').all()));
  for (const row of db.prepare('SELECT at, details FROM extraction_attempts WHERE backend = ? ORDER BY at DESC LIMIT 4').all('post-archiver-improved')) {
    const details = JSON.parse(row.details);
    const patterns = {};
    for (const issue of details.issues) {
      const key = `${issue.code} ${issue.severity} ${issue.location.replace(/\[\d+\]/g, '[*]')}`;
      patterns[key] = (patterns[key] ?? 0) + 1;
    }
    console.log(JSON.stringify({ at: row.at, counts: details.counts, patterns }));
  }
} finally { db.close(); }
