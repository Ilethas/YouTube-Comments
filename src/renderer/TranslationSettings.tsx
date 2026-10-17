import { useEffect, useId, useState } from 'react';
import { normalizeTranslationCode, translationTargets } from '../shared/preferences';
import type { Locale, Preferences, TranslationTarget } from '../shared/preferences';
import type { PreferenceChange } from '../shared/reader-api';
import { translator } from './i18n';

/** A custom draft becomes active only after an acknowledged atomic save. */
export function TranslationSettings({ preferences, locale, disabled, save }: {
  preferences: Pick<Preferences, 'translationTarget' | 'customTranslationTarget'>; locale: Locale; disabled: boolean;
  save: (change: PreferenceChange) => Promise<boolean>;
}) {
  const t = translator(locale), helpId = useId(), errorId = useId();
  const [choosingCustom, setChoosingCustom] = useState(false);
  const [draft, setDraft] = useState(preferences.customTranslationTarget ?? '');
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty && draft !== (preferences.customTranslationTarget ?? '')) setDraft(preferences.customTranslationTarget ?? '');
  }, [preferences.customTranslationTarget, dirty, draft]);
  const [help, setHelp] = useState(false), [invalid, setInvalid] = useState(false), [failed, setFailed] = useState(false);
  const custom = choosingCustom || preferences.translationTarget === 'custom';
  async function select(next: TranslationTarget) {
    setInvalid(false); setFailed(false);
    if (next === 'custom') {
      setDirty(false);
      setChoosingCustom(true); setDraft(preferences.customTranslationTarget ?? '');
      if (!preferences.customTranslationTarget) return;
    }
    if (await save({ translationTarget: next })) { setDirty(false); setChoosingCustom(false); }
    else setFailed(true);
  }
  async function commit() {
    const code = normalizeTranslationCode(draft);
    setInvalid(!code); setFailed(false);
    if (!code) return;
    if (await save({ translationTarget: 'custom', customTranslationTarget: code })) { setDirty(false); setDraft(code); setChoosingCustom(false); }
    else setFailed(true);
  }
  return <div className="translation-settings">
    <label>{t('translationTarget')}<select value={custom ? 'custom' : preferences.translationTarget} disabled={disabled}
      onChange={event => { void select(event.target.value as TranslationTarget); }}>
      {translationTargets.map(value => <option key={value} value={value}>{t(({ app: 'targetApp', en: 'targetEn', pl: 'targetPl', de: 'targetDe', fr: 'targetFr', es: 'targetEs', it: 'targetIt', pt: 'targetPt', ja: 'targetJa', ko: 'targetKo', 'zh-CN': 'targetZh', custom: 'targetCustom' } as const)[value])}</option>)}
    </select></label>
    {custom && <>
      <div className="custom-translation-controls">
        <label>{t('customTargetCode')}<input value={draft} maxLength={128} spellCheck={false} autoCapitalize="none" disabled={disabled}
          aria-invalid={invalid || undefined} aria-describedby={`${helpId}${invalid || failed ? ` ${errorId}` : ''}`}
          onChange={event => { setDirty(true); setDraft(event.target.value); setInvalid(false); setFailed(false); }} /></label>
        <button type="button" aria-label={t('customTargetHelpLabel')} aria-expanded={help} aria-controls={helpId} onClick={() => setHelp(value => !value)}>?</button>
        <button type="button" disabled={disabled} onClick={() => { void commit(); }}>{t('customTargetSave')}</button>
      </div>
      <small>{t('customTargetExamples')}</small>
      <p id={helpId} hidden={!help}>{t('customTargetHelp')}</p>
      {(invalid || failed) && <p id={errorId} role="alert">{t(invalid ? 'customTargetInvalid' : 'saveError')}</p>}
    </>}
  </div>;
}
