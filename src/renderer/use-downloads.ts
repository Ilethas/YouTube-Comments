import { useEffect, useRef, useState } from 'react';
import { isDownloadsSnapshot } from '../shared/downloads';
import type { DownloadsApi, DownloadsSnapshot } from '../shared/downloads';

/** Subscribe first; monotonic revision fences delayed hydration and old events. */
export class DownloadsReplica {
  current?: DownloadsSnapshot;
  private readonly retired = new Set<string>();
  accept(value: DownloadsSnapshot): DownloadsSnapshot | undefined {
    if (!isDownloadsSnapshot(value) || this.retired.has(value.profileEpoch)) return this.current;
    if (this.current?.profileEpoch === value.profileEpoch && value.revision <= this.current.revision) return this.current;
    if (this.current && this.current.profileEpoch !== value.profileEpoch) this.retired.add(this.current.profileEpoch);
    this.current = value; return value;
  }
}
export function useDownloads(api?: DownloadsApi) {
  const [snapshot, setSnapshot] = useState<DownloadsSnapshot>();
  const model = useRef(new DownloadsReplica());
  useEffect(() => {
    if (!api) return;
    let live = true;
    const accept = (value: DownloadsSnapshot) => { if (live) setSnapshot(model.current.accept(value)); };
    const unsubscribe = api.onChanged(accept);
    void api.current().then(result => { if (result.ok) accept(result.value); }).catch(() => undefined);
    return () => { live = false; unsubscribe(); };
  }, [api]);
  return snapshot?.jobs ?? [];
}
