/** Usable anonymous remote image evidence. Reject credentials, non-HTTPS schemes,
 * whitespace/control characters and ambiguous URL spellings before rendering. */
export function isHttpsImageUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value.startsWith('https://') || /\s/u.test(value)
    || [...value].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
