// eslint-disable-next-line import/no-unresolved
import { describe, expect, it } from 'vitest';
import { buildCommunityCommand, buildYtDlpCommand } from './invocation';

describe('pure helper specifications', () => {
  it('describes isolated yt-dlp JSON/comment extraction with bounded retries and no tolerant success flags', () => {
    const spec = buildYtDlpCommand({ videoUrl: 'https://www.youtube.com/watch?v=VidDemo_001&list=ignored', timeoutSeconds: 20, retries: 2, maxComments: 5 });
    expect(spec).toEqual({ backend: 'yt-dlp', executable: 'yt-dlp', output: 'single-json-stdout', environmentAdditions: {}, arguments: ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--skip-download', '--dump-single-json', '--write-comments', '--socket-timeout', '20', '--retries', '2', '--extractor-retries', '2', '--extractor-args', 'youtube:max_comments=5', '--', 'https://www.youtube.com/watch?v=VidDemo_001'] });
    expect(spec.arguments).not.toContain('--ignore-errors');
    expect(spec.arguments).not.toContain('--ignore-no-formats-error');
    expect(spec.arguments).not.toContain('--check-formats');
    expect(buildYtDlpCommand({ videoUrl: 'https://www.youtube.com/watch?v=VidDemo_001', timeoutSeconds: 20, retries: 2 }).arguments).not.toContain('--extractor-args');
  });

  it('keeps explicit Community paths/limits and child-only Unicode environment; no --quiet or cookies', () => {
    const environmentBefore = [process.env.PYTHONUTF8, process.env.PYTHONIOENCODING];
    const spec = buildCommunityCommand({ postUrl: 'https://www.youtube.com/post/UgkDemoPost_0123456789', outputDirectory: 'C:\\Disposable Output', configFile: 'C:\\Disposable Output\\config.json', maxComments: 100, maxReplies: 200, timeoutSeconds: 20, retries: 2 });
    expect(spec.arguments).toEqual(['--comments', '--output', 'C:\\Disposable Output', '--config', 'C:\\Disposable Output\\config.json', '--max-comments', '100', '--max-replies', '200', '--timeout', '20', '--retries', '2', '--', 'https://www.youtube.com/post/UgkDemoPost_0123456789']);
    expect(spec.environmentAdditions).toEqual({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' });
    expect(spec.output).toBe('archive-json-directory');
    expect([process.env.PYTHONUTF8, process.env.PYTHONIOENCODING]).toEqual(environmentBefore);
  });

  it('rejects unsupported targets and unbounded/invalid numeric inputs', () => {
    const input = { videoUrl: 'https://www.youtube.com/watch?v=VidDemo_001', timeoutSeconds: 20, retries: 2 };
    for (const videoUrl of ['https://example.invalid/watch?v=x', 'http://www.youtube.com/watch?v=x', 'https://www.youtube.com/playlist?list=x', 'https://user:secret@www.youtube.com/watch?v=x']) expect(() => buildYtDlpCommand({ ...input, videoUrl })).toThrow();
    for (const retries of [-1, Number.MAX_SAFE_INTEGER + 1, Infinity, 1.5]) expect(() => buildYtDlpCommand({ ...input, retries })).toThrow();
    expect(() => buildYtDlpCommand({ ...input, timeoutSeconds: 0 })).toThrow();
    expect(() => buildYtDlpCommand({ ...input, maxComments: 0 })).toThrow();
    expect(() => buildCommunityCommand({ postUrl: 'https://www.youtube.com/@channel/community', outputDirectory: 'tmp', configFile: 'config.json', maxComments: 1, maxReplies: 1, timeoutSeconds: 20, retries: 2 })).toThrow();
  });
});
