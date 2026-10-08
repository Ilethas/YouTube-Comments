/** Fixed helper identities and exact supported versions; no renderer command/path input. */
export type HelperKind = 'yt-dlp' | 'post-archiver';
export const helperKinds: readonly HelperKind[] = ['yt-dlp', 'post-archiver'];
export const requiredHelperVersions = { 'yt-dlp': '2026.08.19', 'post-archiver': '0.4.0' } as const;
export interface HelperRequest { readonly kind: HelperKind }
/** Paths are display-only evidence. Raw process output never crosses this boundary. */
export interface HelperStatus {
  readonly kind: HelperKind;
  readonly mode: 'environment' | 'configured' | 'PATH' | 'unavailable';
  readonly path?: string;
  readonly version?: string;
  readonly requiredVersion: string;
  readonly state: 'ready' | 'unavailable' | 'incompatible' | 'invalid-path';
}
