import { useCallback, useEffect, useRef, useState } from 'react';
import type { NotificationDismissal, NotificationDuration } from '../shared/preferences';
import { ActionIcon } from './ActionIcon';

type Kind = 'pending' | 'success' | 'error';
interface Notice<Message extends string = string> {
  readonly id: number; readonly message: Message; readonly kind: Kind; readonly dismissed: boolean;
}

/** One session-only slot. Every replacement owns a new timer identity. A pending
 * operation may settle after dismissal, but cannot replace a newer operation. */
export function useNotification<Message extends string>() {
  const sequence = useRef(0);
  const [notification, setNotification] = useState<Notice<Message>>();
  const show = useCallback((message: Message, kind: Kind) => {
    const id = ++sequence.current;
    setNotification({ id, message, kind, dismissed: false });
    return id;
  }, []);
  const settle = useCallback((pendingId: number, message: Message, kind: 'success' | 'error') => {
    const id = ++sequence.current;
    setNotification(current => current?.id === pendingId ? { id, message, kind, dismissed: false } : current);
  }, []);
  const dismiss = useCallback((id: number) => {
    setNotification(current => current?.id === id ? { ...current, dismissed: true } : current);
  }, []);
  return { notification, show, settle, dismiss };
}

export function Notification({ notification, message, mode, seconds, closeLabel, dismiss }: {
  notification?: Notice; message: string; mode: NotificationDismissal; seconds: NotificationDuration;
  closeLabel: string; dismiss: (id: number) => void;
}) {
  const [hovered, setHovered] = useState(false), [focused, setFocused] = useState(false);
  const remaining = useRef(seconds * 1000);
  const visible = !!notification && !notification.dismissed;
  useEffect(() => { remaining.current = seconds * 1000; }, [notification?.id, mode, seconds]);
  useEffect(() => {
    if (!notification || !visible || notification.kind !== 'success' || mode !== 'automatic' || hovered || focused) return;
    const started = performance.now();
    const timer = window.setTimeout(() => dismiss(notification.id), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (performance.now() - started)); };
  }, [notification, visible, mode, seconds, hovered, focused, dismiss]);
  // The close control stays outside the stable live region. Dismissal only
  // clears its text; it never focuses another element or re-announces a message.
  return <div className="notification-overlay" data-visible={visible}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
    <p className="move-feedback" role="status" aria-live="polite" aria-atomic="true">{visible ? message : ''}</p>
    {visible && <button type="button" className="notification-close" aria-label={closeLabel} title={closeLabel}
      onClick={() => { dismiss(notification.id); setFocused(false); setHovered(false); }}><ActionIcon name="cancel" /></button>}
  </div>;
}
