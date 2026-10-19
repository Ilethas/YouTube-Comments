/** Native accelerators own these chords; renderer menus only display them. */
export const windowAccelerators = (mac = false) => ({
  newWindow: 'CmdOrCtrl+N', closeWindow: 'CmdOrCtrl+Shift+W', quitApplication: mac ? 'Cmd+Q' : 'Ctrl+Shift+Q',
} as const);
export function windowShortcutLabel(action: keyof ReturnType<typeof windowAccelerators>, mac = false): string {
  return windowAccelerators(mac)[action].replace('CmdOrCtrl', mac ? 'Cmd' : 'Ctrl');
}
