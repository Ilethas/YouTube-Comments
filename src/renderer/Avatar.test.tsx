// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { Avatar } from './Avatar';
afterEach(cleanup);

it('renders an anonymous lazy fixed-size HTTPS avatar; failure falls back and a changed URL can load', () => {
  const { container, rerender } = render(<Avatar url="https://example.invalid/a.png" author="Example" locale="en" />);
  const img = container.querySelector('img');
  expect(img?.getAttribute('loading')).toBe('lazy');
  expect(img?.getAttribute('decoding')).toBe('async');
  expect(img?.getAttribute('referrerpolicy')).toBe('no-referrer');
  expect(img?.getAttribute('crossorigin')).toBe('anonymous');
  expect(img?.getAttribute('alt')).toBe('');
  expect(img?.getAttribute('width')).toBe('32');
  expect(img?.getAttribute('height')).toBe('32');
  if (!img) throw new Error('Missing img');
  fireEvent.error(img);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('E');
  rerender(<Avatar url="https://example.invalid/b.png" author="Example" locale="en" />);
  expect(container.querySelector('img')?.getAttribute('src')).toBe('https://example.invalid/b.png');
});

it.each([undefined, '', 'http://example.invalid/a', 'data:image/svg+xml,evil', 'https://user:pass@example.invalid/a'])('uses a placeholder for unavailable/unsafe URL %s', url => {
  const { container } = render(<Avatar url={url} author="Łukasz" locale="pl" />);
  expect(container.querySelector('img')).toBeNull();
  expect(container.textContent).toBe('Ł');
});
