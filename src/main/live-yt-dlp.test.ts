import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { AcquisitionService } from './acquisition-service';
import { createHelperResolver } from './helper-process';
import { createLiveExtractor } from './live-extraction';
import { ReaderRepository } from './persistence/reader-repository';
import type { AcquisitionNotification } from '../shared/acquisition';
import { isAcquisitionNotification } from '../shared/acquisition';

/** Opt-in anonymous network check. Never opens the owner's application profile or
 * retains raw JSON/diagnostics. Normal tests require no helper or network access. */
it.skipIf(!process.env.YOUTUBE_COMMENTS_LIVE_YTDLP_EXE)('installed yt-dlp streams counts, ingests JSON, refreshes and cancels cleanly', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'reader-live-progress-'));
  const repository = ReaderRepository.open(path.join(root, 'reader.sqlite'));
  const notifications: AcquisitionNotification[] = [];
  let cancelling = false;
  const service = new AcquisitionService(repository, ['en'], createLiveExtractor({ temporaryRoot: root,
    resolve: createHelperResolver({ YOUTUBE_COMMENTS_YTDLP_EXE: process.env.YOUTUBE_COMMENTS_LIVE_YTDLP_EXE }) }), value => {
    notifications.push(value);
    if (cancelling && !('settled' in value) && value.comments) service.cancel(value.operationId);
  });
  try {
    const start = performance.now();
    const first = await service.acquire('https://www.youtube.com/watch?v=lEZ5UPPtaHA');
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const itemId = first.value.summary.itemId;
    expect(notifications.some(value => !('settled' in value) && (value.comments?.fetched ?? 0) > 0)).toBe(true);
    expect(notifications.every(isAcquisitionNotification)).toBe(true);
    repository.bulkSeen({ itemId, seen: true, target: { kind: 'all' } });
    const refreshed = await service.refresh(itemId);
    expect(refreshed.ok).toBe(true);
    const before = repository.bootstrap(['en']);
    expect(before.comments[itemId].some(comment => comment.seen)).toBe(true);
    cancelling = true;
    expect(await service.refresh(itemId)).toMatchObject({ error: { code: 'ACQUISITION_CANCELLED' } });
    expect(repository.bootstrap(['en'])).toEqual(before);
    expect(repository.history(itemId).at(-1)?.coverage).toMatchObject({ reason: 'user-cancelled' });
    console.log(JSON.stringify({ liveYtDlp: true, elapsedSeconds: Math.round((performance.now() - start) / 1000),
      acquisitionSeconds: Math.round(first.value.timings.totalMs / 1000), storedComments: before.comments[itemId].length,
      numericalNotifications: notifications.filter(value => !('settled' in value) && value.comments).length }));
  } finally { await service.close(); repository.close(); await rm(root, { recursive: true, force: true }); }
}, 1200000);
