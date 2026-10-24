"""Optional offline check against the installed yt-dlp, no requests/plugins.

Run: python scripts/verify-ytdlp-title.py
Uses yt-dlp's actual CLI parser and processing pipeline with a fixture extractor.
"""
import contextlib
import io
import json
import pathlib
import tempfile

import yt_dlp
from yt_dlp.extractor.common import InfoExtractor
from yt_dlp.version import __version__


with tempfile.TemporaryDirectory(prefix='reader-ytdlp-title-') as root:
    title_file = pathlib.Path(root) / 'title.json'
    stdout = io.StringIO()
    deferred = []

    class FixtureIE(InfoExtractor):
        _VALID_URL = r'title-fixture:(?P<id>\w+)'

        def _real_extract(self, url):
            def comments():
                # This is the same deferred hook used by YouTube comments.
                assert json.loads(title_file.read_text(encoding='utf-8')) == 'Early "title" Zażółć'
                assert stdout.getvalue() == '', 'stdout must remain empty until final JSON'
                self.to_screen('Downloading comment API JSON page 1')
                deferred.append(True)
                return {'comments': [{'id': 'comment', 'text': 'fixture'}]}

            return {'id': 'fixture', 'title': 'Early "title" Zażółć',
                    'url': 'https://invalid.example/fixture.mp4', 'ext': 'mp4',
                    '__post_extractor': comments}

    args = ['--ignore-config', '--no-plugin-dirs', '--no-playlist', '--skip-download',
            '--dump-single-json', '--write-comments', '--quiet', '--verbose',
            '--socket-timeout', '15', '--retries', '2', '--extractor-retries', '2',
            '--print-to-file', 'pre_process:%(title|).4096j', str(title_file),
            '--', 'title-fixture:fixture']
    parsed = yt_dlp.parse_options(args)
    baseline = yt_dlp.parse_options(args[:args.index('--print-to-file')] + args[-2:])
    changed = {key for key in parsed.ydl_opts.keys() | baseline.ydl_opts.keys()
               if parsed.ydl_opts.get(key) != baseline.ydl_opts.get(key)}
    assert changed == {'print_to_file'}, changed
    with contextlib.redirect_stdout(stdout):
        with yt_dlp.YoutubeDL(parsed.ydl_opts, auto_init=False) as downloader:
            assert downloader.evaluate_outtmpl('%(title|).4096j', {}) == ''
            assert len(downloader.evaluate_outtmpl('%(title|).4096j', {'title': 'x' * 10000})) == 4096
            downloader.add_info_extractor(FixtureIE())
            assert downloader.download(parsed.urls) == 0
    assert deferred == [True]
    final = json.loads(stdout.getvalue())
    assert final['title'] == 'Early "title" Zażółć'
    assert final['comments'][0]['id'] == 'comment'
    print(f'PASS yt-dlp {__version__}: pre_process title precedes deferred comments; stdout is final JSON only')
