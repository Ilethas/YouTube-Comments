import { backup } from 'node:sqlite';
import type { DatabaseSync } from 'node:sqlite';
import { constants } from 'node:fs';
import { chmod, copyFile, link, mkdir, open, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateBackup } from './backup-validation';

export async function syncFile(file: string): Promise<void> {
  const handle = await open(file, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}
/** fsync directory metadata where supported. Windows does not expose portable
 * directory fsync through Node; durable artifacts and startup recovery remain. */
export async function syncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return;
  const handle = await open(directory, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Privileged diagnostics only; no persistent timing or raw path-bearing event. */
export interface BackupTimings { readonly copyMs: number; readonly verificationMs: number; readonly publicationMs: number }

/** Online SQLite backup, never a live-file copy. A verified, flushed sibling is
 * published with an exclusive hard link: existing destinations stay untouched,
 * including a destination created after the native dialog. Choose another name
 * to replace an existing backup. No truncated successful-looking destination. */
export async function createVerifiedBackup(db: DatabaseSync, destination: string,
  verify: (file: string) => unknown = validateBackup): Promise<BackupTimings> {
  const temporary = path.join(path.dirname(destination), `.backup-${randomUUID()}.partial`);
  try {
    const handle = await open(temporary, 'wx', 0o600); await handle.close();
    const began = performance.now();
    await backup(db, temporary, { rate: 100 });
    const copied = performance.now();
    verify(temporary);
    const verified = performance.now();
    await syncFile(temporary);
    await link(temporary, destination);
    await syncDirectory(path.dirname(destination));
    return { copyMs: copied - began, verificationMs: verified - copied, publicationMs: performance.now() - verified };
  } finally { await Promise.all(['', '-journal', '-wal', '-shm'].map(suffix => rm(temporary + suffix, { force: true }))); }
}

/** Resolve parent junctions/symlinks before rejecting every internal profile file.
 * Publication is exclusive, also protecting existing aliases/hard links. */
export async function validateBackupDestination(destination: string, databasePath: string): Promise<void> {
  if (!path.isAbsolute(destination) || path.extname(destination).toLowerCase() !== '.sqlite') throw new Error('Unsafe backup destination');
  const parent = await realpath(path.dirname(destination));
  const profile = await realpath(path.dirname(databasePath));
  const relative = path.relative(profile, parent);
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) throw new Error('Internal profile destination');
}

/** Copies only a selected standalone snapshot into an exclusive owned location.
 * Sidecars beside the external source are deliberately never consumed. */
export async function stageBackup(source: string, directory: string): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const staged = path.join(directory, 'candidate.sqlite');
  await copyFile(source, staged, constants.COPYFILE_EXCL);
  await chmod(staged, 0o600);
  await syncFile(staged);
  validateBackup(staged);
  return staged;
}
