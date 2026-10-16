// Test-runner only. Materialize every format before native Copy replaces it.
// Electron 44 read entries are lazy and cannot be passed directly to write.
module.exports = async function snapshotClipboard() {
  const { clipboard, ClipboardItem } = require('electron');
  const saved = await Promise.all((await clipboard.read()).map(async item => new ClipboardItem(
    Object.fromEntries(await Promise.all(item.types.map(async type => [type, await item.getType(type)])))
  )));
  return () => clipboard.write(saved);
};
