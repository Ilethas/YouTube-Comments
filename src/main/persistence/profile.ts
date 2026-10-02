import path from 'node:path';

export type DatabaseProfile =
  | { readonly mode: 'production'; readonly appData: string }
  | { readonly mode: 'development'; readonly appData: string }
  | { readonly mode: 'test'; readonly databasePath: string };

/** Privileged path policy: fixed distinct profile names, never userData fallback.
 * Test callers must supply an absolute path inside their own temporary directory. */
export function resolveDatabasePath(profile: DatabaseProfile): string {
  if (profile.mode === 'test') {
    if (!profile.databasePath || !path.isAbsolute(profile.databasePath)) throw new Error('Explicit absolute test database path required');
    return path.normalize(profile.databasePath);
  }
  if (profile.mode !== 'development' && profile.mode !== 'production') throw new Error('Explicit database mode required');
  if (!profile.appData || !path.isAbsolute(profile.appData)) throw new Error('Explicit absolute application data root required');
  const name = profile.mode === 'development' ? 'youtube-comments-development' : 'youtube-comments-production';
  return path.join(profile.appData, name, 'reader.sqlite');
}
