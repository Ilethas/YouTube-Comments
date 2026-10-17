import { expect, it } from 'vitest';
import { normalizeTranslationCode } from './preferences';
import { isPreferenceChange } from './reader-api';

it.each(['uk', 'nl', 'sv', 'zh-TW', 'pt-BR', 'mni-Mtei', ' en '])('validates and trims custom code %s at the IPC boundary', code => {
  expect(normalizeTranslationCode(code)).toBe(code.trim());
  expect(isPreferenceChange({ translationTarget: 'custom', customTranslationTarget: code })).toBe(true);
});
it.each(['', ' ', 'auto', 'AUTO', 'https://example.com', '?tl=uk', '#uk', 'tl=uk', 'u k', 'uk\n', '\tuk', 'en_US', '-en', 'en-', 'en--US', 'en&text=private', 'x'.repeat(36), 'a', '12', null, 1])('rejects unsafe custom code %j', code => {
  expect(normalizeTranslationCode(code)).toBeUndefined();
  expect(isPreferenceChange({ translationTarget: 'custom', customTranslationTarget: code })).toBe(false);
});
it('custom code updates require the atomic custom activation intent and reject extra authority', () => {
  expect(isPreferenceChange({ customTranslationTarget: 'uk' })).toBe(false);
  expect(isPreferenceChange({ translationTarget: 'fr', customTranslationTarget: 'uk' })).toBe(false);
  expect(isPreferenceChange({ translationTarget: 'custom', customTranslationTarget: 'uk', url: 'https://example.com' })).toBe(false);
});
