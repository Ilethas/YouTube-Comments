// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { TranslationSettings } from './TranslationSettings';
import { translator } from './i18n';
import type { Preferences, Locale } from '../shared/preferences';

afterEach(cleanup);
it.each(['en', 'pl'] as const)('%s custom draft validates, accessible help toggles by keyboard/mouse, and only acknowledged Save activates', async locale => {
  const t = translator(locale), save = vi.fn(async () => true);
  const view = render(<TranslationSettings preferences={{ translationTarget: 'fr' }} locale={locale} disabled={false} save={save} />);
  fireEvent.change(screen.getByLabelText(t('translationTarget')), { target: { value: 'custom' } });
  expect(save).not.toHaveBeenCalled(); expect(screen.getByText(t('customTargetExamples'))).toBeTruthy();
  const help = screen.getByRole('button', { name: t('customTargetHelpLabel') });
  help.focus(); await userEvent.keyboard('{Enter}'); expect(help.getAttribute('aria-expanded')).toBe('true');
  expect(document.getElementById(help.getAttribute('aria-controls') ?? '')?.hidden).toBe(false);
  fireEvent.click(help); expect(help.getAttribute('aria-expanded')).toBe('false');
  fireEvent.change(screen.getByLabelText(t('customTargetCode')), { target: { value: 'tl=uk' } });
  fireEvent.click(screen.getByRole('button', { name: t('customTargetSave') }));
  expect(screen.getByRole('alert').textContent).toBe(t('customTargetInvalid')); expect(save).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(t('customTargetCode')), { target: { value: ' uk ' } });
  fireEvent.click(screen.getByRole('button', { name: t('customTargetSave') }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ translationTarget: 'custom', customTranslationTarget: 'uk' }));
  view.rerender(<TranslationSettings preferences={{ translationTarget: 'custom', customTranslationTarget: 'uk' }} locale={locale} disabled={false} save={save} />);
  expect((screen.getByLabelText(t('customTargetCode')) as HTMLInputElement).value).toBe('uk');
});
it('saved custom code survives Custom → preset → Custom and failed saves retain committed target and code', async () => {
  const save = vi.fn(async () => true);
  function Harness() {
    const [preferences, setPreferences] = useState<Pick<Preferences, 'translationTarget' | 'customTranslationTarget'>>({ translationTarget: 'custom', customTranslationTarget: 'uk' });
    return <TranslationSettings preferences={preferences} locale={'en' as Locale} disabled={false} save={async change => {
      const result = await save(); if (result && 'translationTarget' in change) setPreferences(previous => ({ ...previous, ...change })); return result;
    }} />;
  }
  render(<Harness />);
  fireEvent.change(screen.getByLabelText('Translation target language'), { target: { value: 'fr' } });
  await waitFor(() => expect((screen.getByLabelText('Translation target language') as HTMLSelectElement).value).toBe('fr'));
  fireEvent.change(screen.getByLabelText('Translation target language'), { target: { value: 'custom' } });
  await waitFor(() => expect((screen.getByLabelText('Google Translate code') as HTMLInputElement).value).toBe('uk'));
  save.mockResolvedValueOnce(false);
  fireEvent.change(screen.getByLabelText('Google Translate code'), { target: { value: 'nl' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' })); await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
  fireEvent.change(screen.getByLabelText('Translation target language'), { target: { value: 'fr' } });
  await waitFor(() => expect(screen.queryByLabelText('Google Translate code')).toBeNull());
  fireEvent.change(screen.getByLabelText('Translation target language'), { target: { value: 'custom' } });
  await waitFor(() => expect((screen.getByLabelText('Google Translate code') as HTMLInputElement).value).toBe('uk'));
});
