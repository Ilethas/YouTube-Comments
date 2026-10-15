import { constants } from 'node:fs';
import { access, copyFile, link, mkdir, open, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { ReaderRepository } from './reader-repository';
import { schemaVersion } from './migrations';
import { validateBackup } from './backup-validation';
import { createVerifiedBackup, stageBackup, syncDirectory, syncFile } from './sqlite-backup';

export type RestorePhase = 'staged' | 'safety' | 'intent' | 'previous-renamed' | 'previous-moved' | 'candidate-renamed' | 'installed' | 'reopened' | 'accepted'
  | 'rollback-quarantined' | 'rollback-installed';
export type RestoreCheckpoint = (phase: RestorePhase) => void | Promise<void>;
const noop: RestoreCheckpoint = () => undefined;
export const recoveryDirectory = (databasePath: string) => path.join(path.dirname(databasePath), 'recovery');
async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
}
/** Immutable phase records use exclusive publication, never rename-over-existing.
 * File fsync precedes publication; keep all recovery artifacts without pruning. */
async function record(directory: string, name: string): Promise<void> {
  if (await exists(path.join(directory, name))) return;
  const temporary = path.join(directory, `.phase-${randomUUID()}`);
  const handle = await open(temporary, 'wx', 0o600);
  try { await handle.writeFile('youtube-comments restore v1\n'); await handle.sync(); } finally { await handle.close(); }
  await link(temporary, path.join(directory, name));
  await syncDirectory(directory);
  await rm(temporary);
}
/** Freeze external input into a private, migrated, standalone candidate. Current
 * profile data is never opened through a second connection during preflight. */
export async function prepareRestore(source: string, databasePath: string, checkpoint: RestoreCheckpoint = noop): Promise<string> {
  const selected = await realpath(source), live = await realpath(databasePath);
  const [sourceInfo, liveInfo] = await Promise.all([stat(selected), stat(live)]);
  if (!sourceInfo.isFile() || selected.toLowerCase() === live.toLowerCase()
    || sourceInfo.ino === liveInfo.ino && sourceInfo.dev === liveInfo.dev) throw new Error('Cannot stage the live database');
  const directory = path.join(recoveryDirectory(databasePath), `restore-${randomUUID()}`);
  const candidate = await stageBackup(source, directory);
  // Validation established the exact historical application schema, including all
  // triggers, before the existing application migration chain may execute.
  const repository = ReaderRepository.open(candidate);
  try { repository.bootstrap(['en']); repository.prepareOffline(); } finally { repository.close(); }
  validateBackup(candidate);
  await syncFile(candidate);
  await checkpoint('staged');
  return directory;
}
/** Exercise the ordinary integrity/migration/repository boundary while offline. */
export function probeRestoredDatabase(databasePath: string): void {
  if (validateBackup(databasePath) !== schemaVersion) throw new Error('Restore schema mismatch');
  const repository = ReaderRepository.open(databasePath);
  try { repository.bootstrap(['en']); } finally { repository.close(); }
}
/** Requires every live connection/child to be closed by the caller. Intent and
 * safety must exist before the first destructive rename. A crash before accepted
 * always rolls back on startup, even if installation itself happened to finish. */
export async function installRestore(databasePath: string, directory: string,
  checkpoint: RestoreCheckpoint = noop, probe = probeRestoredDatabase): Promise<void> {
  validateBackup(path.join(directory, 'candidate.sqlite'));
  validateBackup(path.join(directory, 'safety.sqlite'));
  for (const suffix of ['-wal', '-shm', '-journal']) if (await exists(databasePath + suffix)) throw new Error('Live SQLite sidecars remain');
  await record(directory, 'intent'); await checkpoint('intent');
  if (await exists(path.join(directory, 'previous.sqlite'))) throw new Error('Previous file already exists');
  await rename(databasePath, path.join(directory, 'previous.sqlite'));
  await checkpoint('previous-renamed');
  await syncDirectory(path.dirname(databasePath)); await syncDirectory(directory);
  await record(directory, 'previous-moved'); await checkpoint('previous-moved');
  if (await exists(databasePath)) throw new Error('Database destination unexpectedly exists');
  await rename(path.join(directory, 'candidate.sqlite'), databasePath);
  await checkpoint('candidate-renamed');
  await syncFile(databasePath); await syncDirectory(path.dirname(databasePath));
  await record(directory, 'installed'); await checkpoint('installed');
  probe(databasePath); await checkpoint('reopened');
  await record(directory, 'accepted'); await checkpoint('accepted');
}

/** Recovery is offline and idempotent, including a crash during recovery itself.
 * Never create an empty fallback. Keep previous, safety and failed candidate files.
 * Unaccepted restores choose the safety snapshot; accepted restores must reopen.
 * A missing/damaged safety copy stops startup with all evidence preserved. */
export async function recoverProfile(databasePath: string, checkpoint: RestoreCheckpoint = noop): Promise<'restored' | 'recovered' | null> {
  const root = recoveryDirectory(databasePath);
  if (!await exists(root)) return null;
  const pending: string[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^restore-[0-9a-f-]{36}$/.test(entry.name)) continue;
    const directory = path.join(root, entry.name);
    const intent = await exists(path.join(directory, 'intent')), complete = await exists(path.join(directory, 'complete'));
    if (!intent && !complete && (await exists(path.join(directory, 'previous.sqlite'))
      || await exists(path.join(directory, 'installed')) || await exists(path.join(directory, 'accepted')))) throw new Error('Restore phase metadata missing; preserve recovery directory');
    if (intent && !complete) pending.push(directory);
  }
  if (pending.length > 1) throw new Error('Multiple interrupted restores; preserve recovery directory');
  if (!pending.length) {
    // Metadata loss must never turn an interrupted replacement into fresh-profile
    // initialization, even on filesystems without portable directory fsync.
    if (!await exists(databasePath) && (await readdir(root)).length) throw new Error('Missing database with recovery artifacts');
    return null;
  }
  const directory = pending[0];
  if (await exists(path.join(directory, 'accepted')) && !await exists(path.join(directory, 'rolling-back'))) {
    try { probeRestoredDatabase(databasePath); await record(directory, 'complete'); return 'restored'; }
    catch { /* Reopen failure must use the independently verified previous data. */ }
  }
  const safety = path.join(directory, 'safety.sqlite');
  probeRestoredDatabase(safety);
  await record(directory, 'rolling-back');
  // Recreate a flushed standalone copy each time; never consume the only recovery.
  const temporary = path.join(directory, `rollback-${randomUUID()}.sqlite`);
  await copyFile(safety, temporary, constants.COPYFILE_EXCL); await syncFile(temporary); probeRestoredDatabase(temporary);
  const abandoned = path.join(directory, `abandoned-${randomUUID()}.sqlite`);
  // Quarantine sidecars together with their database, never alongside replacement.
  for (const suffix of ['', '-wal', '-shm', '-journal']) if (await exists(databasePath + suffix)) await rename(databasePath + suffix, abandoned + suffix);
  await checkpoint('rollback-quarantined');
  await rename(temporary, databasePath); await syncFile(databasePath); await syncDirectory(path.dirname(databasePath));
  await checkpoint('rollback-installed');
  probeRestoredDatabase(databasePath);
  await record(directory, 'rolled-back'); await record(directory, 'complete');
  return 'recovered';
}

/** Async startup protection fits before the existing synchronous migration opener.
 * Every existing recognized older schema gets a verified recoverable snapshot.
 * Failure aborts startup; the migration itself stays transactional and unchanged. */
export async function protectBeforeMigration(databasePath: string): Promise<void> {
  if (!await exists(databasePath)) return;
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const current = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (current >= schemaVersion) return; // Existing opener rejects newer versions.
    // Version 0 with existing bytes is not silently treated as a fresh profile.
    validateBackup(databasePath);
    await mkdir(recoveryDirectory(databasePath), { recursive: true });
    await createVerifiedBackup(db, path.join(recoveryDirectory(databasePath), `pre-migration-v${current}-${randomUUID()}.sqlite`));
  } finally { db.close(); }
}
