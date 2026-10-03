"""Optional anonymous development recapture; prints field-shape counts only.
Requires an explicit direct executable and post URL. Never keeps raw output.
"""
import collections
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import os
import urllib.parse

exe, url = sys.argv[1:]
assert pathlib.Path(exe).is_absolute() and pathlib.Path(exe).is_file()
assert pathlib.Path(exe).suffix.lower() == '.exe'
env = dict(os.environ, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
probe = subprocess.run([exe, '--version'], capture_output=True, env=env, timeout=10)
assert probe.returncode == 0 and probe.stdout.strip() == b'post-archiver 0.4.0'
with tempfile.TemporaryDirectory(prefix='reader-community-diagnostic-') as root:
    folder = pathlib.Path(root)
    output = folder / 'output'
    output.mkdir()
    config = folder / 'anonymous.json'
    config.write_text(json.dumps({'scraping': {'cookies_file': None, 'download_images': False}}))
    result = subprocess.run([exe, '--comments', '--output', str(output), '--config', str(config),
                             '--max-comments', '1000', '--max-replies', '1000', '--timeout', '15', '--retries', '2', '--', url],
                            capture_output=True, env=env, timeout=180)
    print(json.dumps({'exitCode': result.returncode}))
    if result.returncode:
        sys.exit(1)
    files = list(output.glob('*.json'))
    assert len(files) == 1
    raw = json.loads(files[0].read_text(encoding='utf-8'))
    thumbnail = raw['posts'][0].get('author_thumbnail')
    print(json.dumps({'postAvatar': {
        'type': type(thumbnail).__name__,
        'scheme': urllib.parse.urlsplit(thumbnail).scheme if isinstance(thumbnail, str) else None,
        'protocolRelative': isinstance(thumbnail, str) and thumbnail.startswith('//'),
        'containsWhitespace': isinstance(thumbnail, str) and any(char.isspace() for char in thumbnail),
    }}))
    pending = list(raw['posts'][0]['comments'])
    shapes = collections.Counter()
    count = 0
    while pending:
        record = pending.pop()
        pending.extend(record['replies'])
        count += 1
        for key in ['like_count', 'timestamp', 'timestamp_estimated', 'author_thumbnail']:
            value = record.get(key)
            shape = type(value).__name__
            if isinstance(value, str):
                # Recognize fixed metadata grammar without logging arbitrary strings.
                if value == '':
                    shape = 'empty-string'
                elif re.fullmatch(r'[0-9]+', value):
                    shape = 'integer-string'
                elif re.fullmatch(r'[0-9]+ likes?', value):
                    shape = 'integer English like(s) label'
                elif value.startswith('https://'):
                    shape = 'HTTPS-string'
                elif value == 'Like':
                    shape = 'English Like placeholder'
                elif re.fullmatch(r'Like this comment along with [0-9]+ other people', value):
                    shape = 'English accessibility count label'
                else:
                    shape = 'other-string'
            shapes[(key, shape)] += 1
    print(json.dumps({'comments': count, 'fields': [{'field': key, 'shape': shape, 'count': n} for (key, shape), n in sorted(shapes.items())]}))
