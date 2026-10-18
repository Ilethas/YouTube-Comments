# YouTube Comments

A Windows desktop app for reading YouTube discussions without losing your place.
It downloads video comments and individual Community Posts into a local library,
where you can search them, mark what you have read, and come back later.

This is a personal project. Other people are welcome to use it, but development
and maintenance happen as time allows.

![The reader showing nested comments, creator replies, and manual read indicators](docs/screenshots/reader-light.png)

The screenshots use invented discussions and people in the actual Electron app.

## What it does

- Keeps discussions in a local SQLite library, with nested replies and collapsible threads.
- Lets you mark comments seen or unseen yourself. Reading and scrolling never mark them.
- Searches comment text and authors, with optional regex, seen, publication-date,
  and latest-refresh discovery filters. Matching conversations stay together for context.
- Sorts whole conversations while keeping replies in order, with navigation between
  matches and unread comments and an overview ruler beside the reader.
- Shows NEW for comments first discovered in the latest accepted Refresh after the
  initial download. This is separate from publication date and seen status.
- Restores tabs, searches, filters, sort, collapsed replies, and reading position.
- Opens independent reader windows through **File > New Window / Ctrl+N**. Quit
  restores all open windows; closing one among several excludes it next launch.
- Offers comment selection, right-click actions, bulk marking, and Undo for bulk changes.
- Opens author channels and original video comments in your browser. Google Translate
  also opens there, sending comment text only when you explicitly choose Translate.
- Backs up and restores the local library through Settings. The interface supports
  English and Polish, with light, dark, and system appearance.

## Running on Windows

The Windows x64 ZIP is the recommended distribution. Extract **all files** into a
folder, then run `youtube-comments.exe`. Keep the adjacent files and folders;
they include the Electron runtime. You do not need Node.js or npm to run it.
You do need the external tools below to acquire or refresh discussions.

Check the [GitHub Releases](https://github.com/Ilethas/YouTube-Comments/releases)
page for downloadable Windows builds. You can also build the application yourself;
the generated ZIP is located at:

```text
out/make/zip/win32/x64/youtube-comments-win32-x64-1.0.0.zip
```

Squirrel `Setup.exe` is also built under `out/make/squirrel.windows/x64/`, but real
installation, update, and uninstall behavior has not been tested in an isolated
Windows installation. Use the ZIP for now. The binaries are unsigned, so Windows
may show a SmartScreen warning. `1.0.0` is inherited build metadata, not a published
stable release.

## External tools

Helpers are installed separately; the app does not bundle, install, or update them.
Video comments use [yt-dlp](https://github.com/yt-dlp/yt-dlp), and Community Posts
use [post-archiver-improved](https://github.com/sadadYes/post-archiver-improved).

For a pip-based Windows installation, first install
[Python](https://www.python.org/downloads/windows/) with pip and the `py` command
available, then run:

```powershell
py -m pip install --upgrade yt-dlp post-archiver-improved
```

The current upstream requirements are Python 3.10+ for
[yt-dlp](https://pypi.org/project/yt-dlp/) and Python 3.9+ for
[post-archiver-improved](https://pypi.org/project/post-archiver-improved/).
Use a Python version supported by both. Keep that Python installation available:
pip's Windows `.exe` launchers still need it.

The executables are `yt-dlp.exe` and `post-archiver.exe` (the latter has a shorter
name than its pip package). They may be in Python's `Scripts` directory, which
is not always on PATH. In Settings, choose the real executable for each helper
if automatic detection does not find it. The app accepts direct `.exe` launchers,
including pip's launchers, and does not run `.bat` or `.cmd` wrappers.

Tested with this app: yt-dlp `2026.08.19` and post-archiver `0.4.0`. These are
tested versions, not mandatory locks. Other recognized versions can run with an
untested warning; a newer version is not guaranteed to work.

### If a helper does not work

- **Executable not found:** check `py -m pip show yt-dlp post-archiver-improved`
  in PowerShell. If a package is missing, install it with the command above.
- **Scripts is not on PATH:** `py -c "import sysconfig; print(sysconfig.get_path('scripts'))"`
  prints the usual Scripts folder for that Python. For a `--user` installation,
  use `py -c "import sysconfig; print(sysconfig.get_path('scripts', scheme='nt_user'))"`.
  Select the `.exe` files from that folder in Settings, or add the folder to your
  user PATH and restart the app.
- **Invalid path or version:** use Settings → Recheck and make sure you chose the
  right helper. You can check it directly in PowerShell with
  `& 'C:\path\to\yt-dlp.exe' --version` or
  `& 'C:\path\to\post-archiver.exe' --version`.
  Use automatic detection to clear a stale saved choice. An explicit startup
  environment override takes precedence; correct or unset it before relaunching.
- **Detected, but extraction fails:** confirm the URL is a public video or an
  individual Community Post, check your connection, and try again later.
  YouTube changes can break helpers even when their version check passes. Check
  the helper's upstream issues and update it manually if needed. A failed Refresh
  keeps the stored discussion.

More about [helper detection and supported extraction](docs/EXTRACTORS.md).

## Using it

1. Paste a video or individual Community Post URL and choose Acquire.
2. Read, search, and filter the stored comments. Apply updates the local view;
   it does not download anything.
3. Mark comments with their checkboxes, or select several for a bulk action.
   Undo can recover the last bulk change in that discussion.
4. Use Refresh later to fetch comments again and merge changes into your local copy.

There is no automatic synchronization with YouTube. Search and bulk commands work
within the active discussion. Library filtering searches discussion metadata.
See [reading and navigation](docs/UI_AND_NAVIGATION.md) for shortcuts and details.

## More screenshots

An applied search with an unread filter, keeping replies in context:

![Dark reader with an applied audio search, unread filter, match badges, and overview ruler](docs/screenshots/search-dark.png)

A collapsed thread and comments selected for a bulk action:

![Light reader with a collapsed reply branch and three selected comments](docs/screenshots/collapse-selection-light.png)

The [Library view](docs/screenshots/library-light.png) lists saved discussions and
their local counts. Capture details are in [Testing](docs/TESTING.md#readme-screenshots-and-application-icon-2026-10-16).

## Your data

The production profile is `%APPDATA%\youtube-comments-production`, with comments
in `reader.sqlite`. The ZIP does not store data beside the executable; moving or
replacing the app folder on the same Windows account still uses that profile.

Use Settings to create a SQLite backup before moving or replacing data. Restore
replaces the full local profile database, with a confirmation and a safety backup.
Do not copy the live database while the app is open. See
[backup and restore](docs/DATABASE.md) for recovery details.

## Limitations

An acquisition may retrieve only part of a discussion. A successful download does
not prove every remote comment was returned. Helpers are maintained elsewhere,
and changes to YouTube can stop extraction from working. Community replies may
have thread information without a precise direct parent, and Community comment
permalinks are unavailable. The app reads local copies; it does not post replies,
change likes, or manage a YouTube account.

## Development

Built with Electron, React, and TypeScript. For dependencies, build commands,
artifact paths, and Windows verification, see [Packaging](docs/PACKAGING.md).
[Testing](docs/TESTING.md) covers checks; the [documentation map](docs/README.md)
links the reader's behavior and architecture notes.
