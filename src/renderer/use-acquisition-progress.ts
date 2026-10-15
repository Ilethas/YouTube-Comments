import { useEffect, useRef, useState } from 'react';
import type { ReaderApi } from '../shared/reader-api';
import { isAcquisitionNotification } from '../shared/acquisition';
import type { AcquisitionNotification, AcquisitionProgress } from '../shared/acquisition';

/** Retired IDs reject late events; snapshot hydration cannot overtake a notification. */
export class AcquisitionProgressState {
  current: AcquisitionProgress | null = null;
  private readonly retired = new Set<string>();
  accept(value: AcquisitionNotification): AcquisitionProgress | null {
    if (this.retired.has(value.operationId)) return this.current;
    if ('settled' in value) {
      this.retired.add(value.operationId);
      if (this.current?.operationId === value.operationId) this.current = null;
    } else if (!this.current || this.current.operationId === value.operationId) this.current = value;
    return this.current;
  }
}
export function useAcquisitionProgress(api: ReaderApi) {
  const model = useRef(new AcquisitionProgressState());
  const [progress, setProgress] = useState<AcquisitionProgress | null>(null);
  useEffect(() => {
    let mounted = true, notified = false;
    const unsubscribe = api.onAcquisitionProgress(value => {
      if (!mounted || !isAcquisitionNotification(value)) return;
      notified = true;
      setProgress(model.current.accept(value));
    });
    void api.getAcquisitionProgress().then(result => {
      if (mounted && !notified && result.ok && result.value && isAcquisitionNotification(result.value))
        setProgress(model.current.accept(result.value));
    }).catch(() => undefined);
    return () => { mounted = false; unsubscribe(); };
  }, [api]);
  return progress;
}
