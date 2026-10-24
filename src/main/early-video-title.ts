import { lstat, open } from 'node:fs/promises';
import { downloadLabel } from './download-label';

/** Optional side-channel only. Fixed-size reads, serial polling and an awaited
 * stop ensure no reader races workspace cleanup or survives its child. */
export function watchVideoTitle(file: string, signal: AbortSignal, publish: (title: string) => void): () => Promise<void> {
  let stopped = false, delivered = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const read = async () => {
    if (signal.aborted || delivered) return;
    try {
      if (!(await lstat(file)).isFile()) return;
      const handle = await open(file, 'r');
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size === 0 || stat.size > 8192) return;
        const buffer = Buffer.alloc(8193);
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 8192) return;
        const title = downloadLabel(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))));
        if (!title || signal.aborted) return;
        delivered = true;
        try { publish(title); } catch { /* Display observers cannot fail extraction. */ }
      } finally { await handle.close(); }
    } catch { /* Missing, partial, malformed or unreadable metadata keeps the ID. */ }
  };
  let reading: Promise<void> = Promise.resolve();
  const poll = () => {
    reading = read().finally(() => { if (!stopped && !delivered && !signal.aborted) timer = setTimeout(poll, 100); });
  };
  poll();
  return async () => { stopped = true; clearTimeout(timer); await reading; await read(); };
}
