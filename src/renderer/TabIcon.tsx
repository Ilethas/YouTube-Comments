import { ActionIcon } from './ActionIcon';
/** Workspace tabs share the application action vocabulary. */
export function TabIcon({ kind }: { kind: 'video' | 'post' | 'library' | 'settings' }) {
  return <ActionIcon name={kind} />;
}
