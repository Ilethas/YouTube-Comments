import { useEffect, useState } from 'react';
import { ActionIcon } from './ActionIcon';
import type { AcquisitionProgress } from '../shared/acquisition';
import { translator } from './i18n';
import type { Locale } from './i18n';

export function AcquisitionStatus({ progress, locale, updating, cancel }: {
  progress: AcquisitionProgress; locale: Locale; updating?: boolean; cancel: () => Promise<unknown>;
}) {
  const t = translator(locale);
  const [elapsed, setElapsed] = useState(0);
  const [cancelling, setCancelling] = useState(false);
  useEffect(() => {
    // Wall start establishes the offset once; subsequent intervals use monotonic time.
    const initial = Math.max(0, Date.now() - progress.startedAt), start = performance.now();
    const tick = () => setElapsed(Math.floor((initial + performance.now() - start) / 1000));
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [progress.operationId, progress.startedAt]);
  const stage = updating ? 'updating-view' : progress.stage;
  const stageKey = { 'checking-helper': 'stageHelper', preparing: 'stagePreparing', fetching: 'stageFetching',
    processing: 'stageProcessing', saving: 'stageSaving', 'updating-view': 'stageView' } as const;
  return <div className="acquisition-status">
    <span className="acquisition-spinner" aria-hidden="true" />
    <span role="status" title={t(progress.kind === 'refresh' ? 'refreshing' : 'acquiring')}>{t(progress.kind === 'refresh' ? 'operationRefresh' : 'operationAcquire')} <strong>{t(stageKey[stage])}</strong></span>
    <time aria-label={t('operationElapsed')}>{String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}</time>
    {!updating && progress.cancellable && <button disabled={cancelling} onClick={() => {
      setCancelling(true); void cancel().catch(() => undefined).finally(() => setCancelling(false));
    }}><ActionIcon name="cancel" />{t('cancel')}</button>}
  </div>;
}
