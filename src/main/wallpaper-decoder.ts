import { nativeImage, session, WebContentsView } from 'electron';

/** Static app-owned raster conversion. The separate sandbox receives bounded
 * bytes, no paths, preload, Node, permissions, network or reader IPC authority.
 * It is never attached to a native window or enrolled in reader restoration. */
async function webpJpeg(base64: string, width: number, height: number): Promise<string> {
  const input = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([input], { type: 'image/webp' }), { imageOrientation: 'none' });
  try {
    if (bitmap.width !== width || bitmap.height !== height) throw new Error('Invalid dimensions');
    const scale = Math.min(1, 2560 / width, 1600 / height);
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('No canvas');
    context.fillStyle = '#000000'; context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    // Output is bounded by the main-selected canvas dimensions. Avoid spreading
    // millions of arguments or returning a large structured-clone array.
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return btoa(binary);
  } finally { bitmap.close(); }
}

export async function encodeWallpaper(bytes: Buffer, width: number, height: number): Promise<Buffer | undefined> {
  let image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty() && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const decoderSession = session.fromPartition('reader-wallpaper-decoder', { cache: false });
    decoderSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    decoderSession.setPermissionCheckHandler(() => false);
    decoderSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (_details, callback) => callback({ cancel: true }));
    const view = new WebContentsView({ webPreferences: { session: decoderSession, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, devTools: false, backgroundThrottling: false } });
    const contents = view.webContents;
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('will-navigate', event => event.preventDefault());
    contents.on('will-frame-navigate', event => event.preventDefault());
    contents.on('will-redirect', event => event.preventDefault());
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result: unknown = await Promise.race([
        (async () => {
          await contents.loadURL('data:text/html,' + encodeURIComponent('<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'none\'; img-src blob:; connect-src \'none\'">'));
          return contents.executeJavaScript(`(${webpJpeg.toString()})(${JSON.stringify(bytes.toString('base64'))},${width},${height})`);
        })(),
        new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Image deadline')), 10000); }),
      ]);
      if (typeof result !== 'string' || result.length > 16 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(result)) return;
      image = nativeImage.createFromBuffer(Buffer.from(result, 'base64'));
      const scale = Math.min(1, 2560 / width, 1600 / height);
      if (image.isEmpty() || image.getSize().width !== Math.max(1, Math.round(width * scale)) || image.getSize().height !== Math.max(1, Math.round(height * scale))) return;
      return image.toJPEG(90);
    } catch { return; }
    finally { clearTimeout(timer); if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false }); }
  }
  if (image.isEmpty() || image.getSize().width !== width || image.getSize().height !== height) return;
  const scale = Math.min(1, 2560 / width, 1600 / height);
  if (scale < 1) image = image.resize({ width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality: 'good' });
  return image.toJPEG(90);
}
