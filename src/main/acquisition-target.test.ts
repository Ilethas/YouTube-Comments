import { expect, it } from 'vitest';
import { parseAcquisitionTarget } from './acquisition-target';

it.each(['https://youtube.com/watch?v=abcdefghijk&list=anything&t=5#x', 'https://www.youtube.com/watch?v=abcdefghijk', 'https://youtu.be/abcdefghijk?si=tracking'])('canonicalizes video %s', url => {
  expect(parseAcquisitionTarget(url)).toEqual({ sourceKind: 'youtube-video', sourceId: 'abcdefghijk', url: 'https://www.youtube.com/watch?v=abcdefghijk' });
});
it.each(['https://youtube.com/post/UgkDemoPost_0123456789/', 'https://www.youtube.com/post/UgkDemoPost_0123456789?tracking=yes'])('canonicalizes individual post %s', url => {
  expect(parseAcquisitionTarget(url)?.url).toBe('https://www.youtube.com/post/UgkDemoPost_0123456789');
});
it.each(['http://youtube.com/watch?v=abcdefghijk', 'https://evil.com/watch?v=abcdefghijk', 'https://youtube.com.evil.com/watch?v=abcdefghijk',
  'https://user:secret@youtube.com/watch?v=abcdefghijk', 'https://@youtube.com/watch?v=abcdefghijk', 'https://youtube.com/playlist?list=abc', 'https://youtube.com/@channel/community',
  'https://youtube.com/watch?v=', 'https://youtube.com/watch?v=bad', 'https://youtube.com/post/', 'https://youtube.com/post/invalid',
  'https://youtu.be/abcdefghijk/extra', 'https://youtube.com/watch?v=abcdefghijk&v=lmnopqrstuv', 'https://youtube.com:444/watch?v=abcdefghijk',
  'https://youtube.com/watch?v=abcd%0aefghij', 'https://youtube.com/post/Ugkabcdefgh/extra', 'https:\\youtube.com/watch?v=abcdefghijk'])('rejects %s', url => {
  expect(parseAcquisitionTarget(url)).toBeUndefined();
});
