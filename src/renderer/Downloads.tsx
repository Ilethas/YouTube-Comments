import { useEffect, useRef, useState } from 'react';
import { downloadActive, downloadPending } from '../shared/downloads';
import type { DownloadJob, DownloadsApi } from '../shared/downloads';
import { translator } from './i18n';
import type { Locale } from './i18n';
import { ActionIcon } from './ActionIcon';

const stages = { queued: 'downloadQueued', 'checking-helper': 'stageHelper', preparing: 'stagePreparing', fetching: 'stageFetching',
  processing: 'stageProcessing', saving: 'stageSaving', completed: 'downloadCompleted', failed: 'downloadFailed', cancelled: 'downloadCancelled' } as const;
export function DownloadStatus({ job, locale }: { job: DownloadJob; locale: Locale }) {
  const t = translator(locale), number = new Intl.NumberFormat(locale);
  const comments = job.comments;
  return <span className="download-status" data-download-id={job.operationId} data-state={job.state}>
    {downloadActive(job) && <span className="acquisition-spinner" aria-hidden="true" />}
    {t(job.state === 'queued' && job.kind === 'refresh' ? 'refreshQueued' : stages[job.state])}
    {comments && job.state === 'fetching' && <span title={t('commentProgressEstimate')}> — {number.format(comments.fetched)}{comments.estimatedTotal !== undefined && <> / ~{number.format(comments.estimatedTotal)} (≈{number.format(Math.min(99, Math.floor(comments.fetched / comments.estimatedTotal * 100)))}%)</>}</span>}
  </span>;
}
function JobRow({ job, locale, api, open, now }: { job: DownloadJob; locale: Locale; api: DownloadsApi; open: (id: string) => void; now: number }) {
  const t = translator(locale), [pending, setPending] = useState(false), [error, setError] = useState(false);
  const action = async (retry: boolean) => {
    setPending(true); setError(false);
    try { const result = await (retry ? api.retry({ operationId: job.operationId }) : api.cancel({ operationId: job.operationId })); setError(!result.ok); }
    catch { setError(true); } finally { setPending(false); }
  };
  const seconds = Math.max(0, Math.floor(((job.completedAt ?? now) - (job.startedAt ?? job.createdAt)) / 1000));
  return <li className="download-job">
    <strong title={job.label}>{job.label}</strong>
    <div className="download-meta">{t(job.kind === 'refresh' ? 'refresh' : 'acquire')} · <time aria-label={t('operationElapsed')}>{Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}</time></div>
    <DownloadStatus job={job} locale={locale} />
    {job.state === 'fetching' && job.comments?.estimatedTotal && <progress aria-label={t('commentProgressEstimate')} max={100} value={Math.min(99, job.comments.fetched / job.comments.estimatedTotal * 100)} />}
    {job.failure && <small>{t(job.failure === 'HELPER_UNAVAILABLE' ? 'helperUnavailable' : job.failure === 'STORAGE_UNAVAILABLE' ? 'saveError' : 'acquisitionFailed')}</small>}
    {job.coverage && job.coverage !== 'complete' && <small>{t('coverageNotice')}</small>}
    <div className="download-controls">
      {job.cancellable && <button disabled={pending} aria-label={`${t(job.state === 'queued' ? 'removeFromQueue' : 'cancel')} — ${job.label}`} onClick={() => { void action(false); }}><ActionIcon name="cancel" />{t(job.state === 'queued' ? 'removeFromQueue' : 'cancel')}</button>}
      {['failed', 'cancelled'].includes(job.state) && <button disabled={pending} aria-label={`${t('retryDownload')} — ${job.label}`} onClick={() => { void action(true); }}><ActionIcon name="refresh" />{t('retryDownload')}</button>}
      {job.state === 'completed' && job.itemId && <button onClick={() => { if (job.itemId) open(job.itemId); }}><ActionIcon name="library" />{t('openStored')}</button>}
    </div>
    {error && <small role="alert">{t('downloadActionFailed')}</small>}
  </li>;
}
export function Downloads({ jobs, api, locale, open }: { jobs: readonly DownloadJob[]; api: DownloadsApi; locale: Locale; open: (id: string) => void }) {
  const t = translator(locale), [expanded, setExpanded] = useState(false), [now, setNow] = useState(Date.now());
  const root = useRef<HTMLDivElement>(null), button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const active = jobs.filter(downloadActive), queued = jobs.filter(j => j.state === 'queued'), recent = jobs.filter(j => !downloadPending(j)).slice().reverse();
  const groups = [{ title: t('activeDownloads'), jobs: active }, { title: t('queuedDownloads'), jobs: queued }, { title: t('recentDownloads'), jobs: recent }];
  useEffect(() => {
    if (!expanded) return;
    panel.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setExpanded(false); };
    const timer = setInterval(() => setNow(Date.now()), 1000);
    document.addEventListener('pointerdown', outside);
    return () => { clearInterval(timer); document.removeEventListener('pointerdown', outside); };
  }, [expanded]);
  const close = () => { setExpanded(false); button.current?.focus(); };
  return <div className="downloads" ref={root} onBlur={event => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node)) setExpanded(false); }} onKeyDown={event => { if (event.key === 'Escape' && expanded) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button id="downloads-toggle" ref={button} aria-expanded={expanded} aria-controls="downloads-panel" aria-haspopup="dialog" onClick={() => setExpanded(v => !v)}><ActionIcon name="download" />{t('downloads')}{active.length > 0 && <span className="downloads-badge" aria-label={t('activeDownloads')}>{active.length}</span>}</button>
    {expanded && <div ref={panel} id="downloads-panel" className="downloads-panel" role="dialog" aria-label={t('downloads')}>
      <div className="downloads-heading"><strong>{t('downloads')}</strong><button aria-label={t('closeDownloads')} onClick={close}><ActionIcon name="cancel" /></button></div>
      {!jobs.length && <p>{t('downloadsEmpty')}</p>}
      {groups.map(group => group.jobs.length > 0 && <section key={group.title} aria-label={group.title}><h2>{group.title}</h2><ul>{group.jobs.map(job => <JobRow key={job.operationId} job={job} api={api} locale={locale} now={now} open={id => { open(id); close(); }} />)}</ul></section>)}
    </div>}
  </div>;
}
