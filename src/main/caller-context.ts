/** Main-only authority captured at IPC acceptance. Never serialized or supplied
 * by a renderer. A lease expires on navigation, reload, crash or window close;
 * accepted shared operations need not be cancelled when it expires. */
export interface ReaderCallerContext {
  readonly windowId: string;
  readonly rendererLease: string;
  readonly isCurrent: () => boolean;
}
