import { useEffect, useRef, useState } from 'react';
import type { ErrorCode, ReaderApi, Result } from '../shared/reader-api';
import { helperKinds, requiredHelperVersions } from '../shared/helper-settings';
import type { HelperKind, HelperStatus } from '../shared/helper-settings';
import { translator } from './i18n';
import type { Locale } from './i18n';

/** Lazy once-per-mounted Settings check; acknowledgments never affect discussion data. */
export function ExternalTools({ api, locale, active }: { api: ReaderApi; locale: Locale; active: boolean }) {
  const t = translator(locale);
  return <section className="external-tools" aria-label={t('externalTools')}>
    <h2>{t('externalTools')}</h2><p className="reader-help">{t('externalToolsHelp')}</p>
    {helperKinds.map(kind => <HelperTool key={kind} kind={kind} api={api} locale={locale} active={active} />)}
  </section>;
}

function HelperTool({ kind, api, locale, active }: { kind: HelperKind; api: ReaderApi; locale: Locale; active: boolean }) {
  const t = translator(locale);
  const [status, setStatus] = useState<HelperStatus>();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorCode>();
  const checked = useRef(false), busy = useRef(false), mounted = useRef(false);
  async function run(action: () => Promise<Result<HelperStatus | null>>) {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(undefined);
    try {
      const result = await action();
      if (!mounted.current) return;
      if (result.ok) { if (result.value) setStatus(result.value); }
      else setError(result.error.code);
    } catch { if (mounted.current) setError('STORAGE_UNAVAILABLE'); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (active && !checked.current) { checked.current = true; void run(() => api.getHelperStatus({ kind })); }
  }, [active, api, kind]);
  const environment = status?.mode === 'environment';
  const modeKey = status?.mode === 'environment' ? 'helperEnvironment' : status?.mode === 'configured' ? 'helperCustom' : 'helperAutomatic';
  const stateKey = !status ? 'helperUnchecked' : status.state === 'ready' ? 'helperReady' : status.state === 'incompatible'
    ? 'helperStatusIncompatible' : status.state === 'invalid-path' ? 'helperInvalidPath' : 'helperStatusUnavailable';
  const name = kind === 'yt-dlp' ? 'yt-dlp' : 'post-archiver';
  return <article className="helper-tool" aria-label={name} aria-busy={pending}>
    <div className="helper-heading"><h3>{name}</h3><span>{t(modeKey)}</span><strong role="status">{t(pending ? 'helperChecking' : stateKey)}</strong></div>
    {status?.path !== undefined && <p className="helper-path" title={status.path}>{status.path || t('helperEmptyPath')}</p>}
    <p className="helper-version">{t('helperRequiredVersion', { version: requiredHelperVersions[kind] })}
      {status?.version && <> · {t('helperDetectedVersion', { version: status.version })}</>}</p>
    {environment && <p className="reader-help">{t('helperEnvironmentHelp')}</p>}
    <div className="helper-actions">
      <button disabled={pending || !status || environment} onClick={() => { void run(() => api.chooseHelper({ kind })); }}>{t('helperBrowse')}</button>
      <button disabled={pending || status?.mode !== 'configured'} onClick={() => { void run(() => api.clearHelper({ kind })); }}>{t('helperAutomaticAction')}</button>
      <button disabled={pending} onClick={() => { void run(() => api.getHelperStatus({ kind })); }}>{t('helperRecheck')}</button>
    </div>
    {error && <p role="alert">{t(error === 'HELPER_INCOMPATIBLE' ? 'helperSelectionIncompatible'
      : error === 'HELPER_UNAVAILABLE' ? 'helperSelectionUnavailable' : 'helperSettingsFailed')}</p>}
  </article>;
}
