import { useEffect, useId, useState } from 'react';
import type { Appearance, Locale, Preferences } from '../shared/preferences';
import type { ErrorCode, PreferenceChange, ReaderApi, Result } from '../shared/reader-api';
import { defaultReaderAppearance } from '../shared/appearance';
import type { ThemeExportSource } from '../shared/appearance';
import { translator } from './i18n';

/** Sliders keep a local draft. Apply makes exactly one acknowledged CAS write;
 * peer changes never silently overwrite an edited draft or its base revision. */
export function AppearanceSettings({ preferences, locale, disabled, api, save, imported, onDirty, missingWallpaper }: {
  preferences: Pick<Preferences, 'appearance' | 'readerAppearance'>; locale: Locale; disabled: boolean; api: Pick<ReaderApi, 'importTheme' | 'importWallpaper' | 'exportTheme'>;
  save: (change: PreferenceChange) => Promise<boolean>;
  imported: (action: () => Promise<Result<Preferences | null>>) => Promise<boolean>;
  onDirty: (dirty: boolean) => void; missingWallpaper: boolean;
}) {
  const t = translator(locale), id = useId(), current = preferences.readerAppearance ?? defaultReaderAppearance;
  const [draft, setDraft] = useState(current), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorCode>();
  const [exportSource, setExportSource] = useState<ThemeExportSource>('current');
  useEffect(() => { if (!dirty) setDraft(current); }, [current, dirty]);
  useEffect(() => { onDirty(dirty); return () => onDirty(false); }, [dirty, onDirty]);
  const blocked = disabled || pending;
  async function exportFile() {
    if (!api.exportTheme) return;
    setPending(true); setError(undefined);
    try { const result = await api.exportTheme({ source: exportSource }); if (!result.ok) setError('DATA_WRITE_FAILED'); }
    catch { setError('DATA_WRITE_FAILED'); }
    finally { setPending(false); }
  }
  async function importFile(kind: 'theme' | 'wallpaper') {
    const action = kind === 'theme' ? api.importTheme : api.importWallpaper;
    if (!action) return;
    setPending(true); setError(undefined);
    try { await imported(async () => { const result = await action(); if (!result.ok) setError(result.error.code); return result; }); }
    catch { setError('APPEARANCE_IMPORT_FAILED'); }
    finally { setPending(false); }
  }
  async function apply() {
    setError(undefined);
    if (await save({ readerAppearance: { expectedRevision: draft.revision, customThemeId: draft.customThemeId, wallpaperEnabled: draft.wallpaperEnabled, surfaceOpacity: draft.surfaceOpacity, blur: draft.blur } })) setDirty(false);
    else setError('STATE_CONFLICT');
  }
  return <fieldset className="appearance-settings" disabled={blocked}>
    <legend>{t('appearance')}</legend>
    <label>{t('appearance')}<select value={preferences.appearance} onChange={event => { void save({ appearance: event.target.value as Appearance }); }}>
      {(['system', 'light', 'dark', 'charcoal'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
      {current.customThemeId && <option value="custom">{t('customTheme')}</option>}
    </select></label>
    <div className="appearance-actions"><button type="button" disabled={dirty || !api.importTheme} onClick={() => { void importFile('theme'); }}>{t('importTheme')}</button></div>
    <label>{t('themeToExport')}<select value={exportSource} onChange={event => setExportSource(event.target.value as ThemeExportSource)}>
      <option value="current">{t('currentTheme')}</option>
      {(['light', 'dark', 'charcoal'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
      <option value="warm-graphite">Warm Graphite</option>
    </select></label>
    <button type="button" disabled={!api.exportTheme} onClick={() => { void exportFile(); }}>{t('exportTheme')}</button>
    <p>{t('themeExportHelp')}</p>
    {!!current.themes.length && <>
      <label>{t('customTheme')}<select disabled={dirty} value={current.customThemeId ?? ''} onChange={event => {
        void save({ readerAppearance: { expectedRevision: current.revision, customThemeId: event.target.value || null, wallpaperEnabled: current.wallpaperEnabled, surfaceOpacity: current.surfaceOpacity, blur: current.blur } });
      }}><option value="">{t('noCustomTheme')}</option>{current.themes.map(theme => <option key={theme.id} value={theme.id}>{theme.definition.name}</option>)}</select></label>
      <button type="button" disabled={dirty || !current.customThemeId} onClick={() => { if (current.customThemeId) void save({ deleteTheme: { id: current.customThemeId, expectedRevision: current.revision } }); }}>{t('deleteTheme')}</button>
    </>}
    <h2>{t('readerWallpaper')}</h2>
    <div className="appearance-actions"><button type="button" disabled={dirty || !api.importWallpaper} onClick={() => { void importFile('wallpaper'); }}>{t('chooseWallpaper')}</button>
      <button type="button" disabled={dirty || !current.wallpaperId} onClick={() => { void save({ removeWallpaper: { expectedRevision: current.revision } }); }}>{t('removeWallpaper')}</button></div>
    <p role="status">{t(current.wallpaperId ? missingWallpaper ? 'wallpaperMissing' : 'wallpaperSelected' : 'wallpaperNone')}</p>
    <label><input type="checkbox" disabled={!current.wallpaperId} checked={draft.wallpaperEnabled} onChange={event => { setDraft({ ...draft, wallpaperEnabled: event.target.checked }); setDirty(true); }} />{t('enableWallpaper')}</label>
    <label htmlFor={`${id}-opacity`}>{t('surfaceOpacity')} <output htmlFor={`${id}-opacity`}>{draft.surfaceOpacity}%</output></label>
    <input id={`${id}-opacity`} type="range" min="0" max="100" step="1" value={draft.surfaceOpacity} aria-valuetext={`${draft.surfaceOpacity}%`}
      onChange={event => { setDraft({ ...draft, surfaceOpacity: Number(event.target.value) }); setDirty(true); }} />
    <label htmlFor={`${id}-blur`}>{t('backgroundBlur')} <output htmlFor={`${id}-blur`}>{draft.blur} px</output></label>
    <input id={`${id}-blur`} type="range" min="0" max="20" step="1" value={draft.blur} aria-valuetext={`${draft.blur} px`}
      onChange={event => { setDraft({ ...draft, blur: Number(event.target.value) }); setDirty(true); }} />
    <p>{t('wallpaperApplyHelp')}</p>
    <div className="appearance-actions"><button type="button" disabled={!dirty} onClick={() => { void apply(); }}>{t('applyAppearance')}</button>
      <button type="button" disabled={!dirty} onClick={() => { setDraft(current); setDirty(false); setError(undefined); }}>{t('cancelAppearance')}</button>
      <button type="button" onClick={() => { setDraft({ ...current, wallpaperEnabled: false, surfaceOpacity: 92, blur: 8 }); setDirty(true); }}>{t('appearanceDefaults')}</button></div>
    <p>{t('appearanceBackupHelp')}</p>
    {error && <p className="query-error" role="alert">{t(error === 'DATA_WRITE_FAILED' ? 'themeExportFailed' : error === 'INVALID_THEME' ? 'invalidTheme' : error === 'INVALID_WALLPAPER' ? 'invalidWallpaper' : error === 'THEME_LIMIT' ? 'themeLimit' : error === 'STATE_CONFLICT' ? 'appearanceConflict' : 'appearanceImportFailed')}</p>}
  </fieldset>;
}
