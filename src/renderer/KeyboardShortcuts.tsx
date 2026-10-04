import { translator } from './i18n';
import type { Locale } from './i18n';
import { shortcuts, shortcutKeyLabels } from './shortcuts';

/** Stable application target for F1, focused only after acknowledged Settings activation. */
export const keyboardShortcutsTarget = 'keyboard-shortcuts';

export function KeyboardShortcuts({ locale }: { locale: Locale }) {
  const t = translator(locale);
  const groups = [...new Set(shortcuts.map(definition => definition.group))];
  return <section className="keyboard-shortcuts" aria-labelledby={keyboardShortcutsTarget}>
    <h2 id={keyboardShortcutsTarget} tabIndex={-1}>{t('keyboardShortcuts')}</h2>
    <p className="reader-help">{t('shortcutPlatformHelp')}</p>
    {groups.map(group => <div key={group}>
      <h3>{t(group)}</h3>
      <table aria-label={t(group)}><tbody>{shortcuts.filter(definition => definition.group === group).map(definition =>
        <tr key={definition.id} data-shortcut-id={definition.id}>
          <th scope="row">{t(definition.description)}{'scope' in definition && <small>{t(definition.scope)}</small>}</th>
          <td>{shortcutKeyLabels(definition.id).map((key, index) => <span key={key}>{index > 0 && '+'}<kbd>{key}</kbd></span>)}</td>
        </tr>)}</tbody></table>
    </div>)}
  </section>;
}
