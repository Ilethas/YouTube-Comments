import { expect, it } from 'vitest';
import type { CommentProgress } from '../../shared/acquisition';
import { YtDlpProgressParser } from './yt-dlp-progress';

const note = (counts: string, kind = 'page 51') => `[youtube]     Downloading comment API JSON ${kind} (${counts})`;
it('recognizes extraction notes across every byte split and CR/LF boundaries', () => {
  const input = `${note('1755/~8721')}\r\n${note('1770/~8721', 'reply thread 52')}\r[youtube] id:        Downloading comment replies API JSON page 3 (1780/9000)\n`;
  for (let split = 0; split <= Buffer.byteLength(input); split++) {
    const values: CommentProgress[] = [], parser = new YtDlpProgressParser(value => values.push(value));
    const buffer = Buffer.from(input);
    parser.push(buffer.subarray(0, split)); parser.push(buffer.subarray(split)); parser.end();
    expect(values).toEqual([{ fetched: 1755, estimatedTotal: 8721 }, { fetched: 1770, estimatedTotal: 8721 }, { fetched: 1780, estimatedTotal: 9000 }]);
  }
});
it('handles missing, unknown, zero, underestimated and changing totals without inventing counts', () => {
  const values: CommentProgress[] = [], parser = new YtDlpProgressParser(value => values.push(value));
  for (const counts of ['0/~None', '1', '2/~?', '3/unknown', '4/0', '5/~4', '6/~10', '6/~20', '7/~8']) parser.push(Buffer.from(note(counts) + '\n'));
  expect(values).toEqual([{ fetched: 0 }, { fetched: 1 }, { fetched: 2 }, { fetched: 3 }, { fetched: 4 }, { fetched: 5 },
    { fetched: 6, estimatedTotal: 10 }, { fetched: 6, estimatedTotal: 20 }, { fetched: 7, estimatedTotal: 8 }]);
});
it('rejects malformed/unrelated/unsafe notes and ignores backwards counts', () => {
  const values: CommentProgress[] = [], parser = new YtDlpProgressParser(value => values.push(value));
  for (const line of ['arbitrary private text (123/~456)', note('-1/~9'), note('1.5/~9'), note('NaN/~9'), note('Infinity/~9'),
    note('9007199254740992/~9007199254740993'), note('10/~20') + ' private suffix', note('10/~20'), note('9/~30'), note('11/~9007199254740992')]) parser.push(Buffer.from(line + '\n'));
  expect(values).toEqual([{ fetched: 10, estimatedTotal: 20 }, { fetched: 11 }]);
});
it('bounds unterminated diagnostics, discards entire oversized lines and tracks late split warnings', () => {
  const values: CommentProgress[] = [], parser = new YtDlpProgressParser(value => values.push(value));
  parser.push(Buffer.alloc(100000, 65));
  parser.push(Buffer.from(note('10/~20') + '\n'));
  for (const byte of Buffer.from('WARNING: private path\n' + note('11/~20'))) parser.push(Buffer.from([byte]));
  parser.end();
  expect(parser.hasWarning).toBe(true);
  expect(values).toEqual([{ fetched: 11, estimatedTotal: 20 }]);
});
