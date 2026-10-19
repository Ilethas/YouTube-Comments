import { useEffect, useRef, useState } from 'react';

/** Presentation only. M3 input freezing and drain ordering never await this timer.
 * Identity fencing prevents an old operation's timeout painting a later one. */
export function useProfileProgress(busy: boolean, identity: string | undefined, failed: boolean) {
  const [shown, setShown] = useState<string>();
  const current = useRef({ busy, identity }); current.current = { busy, identity };
  useEffect(() => {
    if (!busy || !identity) { setShown(undefined); return; }
    const timer = setTimeout(() => {
      if (current.current.busy && current.current.identity === identity) setShown(identity);
    }, 180);
    return () => clearTimeout(timer);
  }, [busy, identity]);
  return busy && (failed || !!identity && shown === identity);
}
