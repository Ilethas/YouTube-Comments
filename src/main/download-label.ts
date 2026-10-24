/** Untrusted helper/stored text becomes a small display-only label. */
export function downloadLabel(value: unknown): string {
  if (typeof value !== 'string') return '';
  // Explicitly remove control characters from display-only helper text.
  // eslint-disable-next-line no-control-regex
  return value.slice(0, 180).replace(/[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/[\ud800-\udbff]$/, '').trim();
}
