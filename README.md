# YouTube discussion reader

A development-preview Windows reader for persistent YouTube discussions, with manual
seen state, local search/filtering, durable history and SQLite backup/restore.

Windows x64 no-install distribution: extract the **entire ZIP**, then run
`youtube-comments.exe`. Keep all adjacent files. Data stays in
`%APPDATA%/youtube-comments-production`; copying the application folder on the same
Windows account reuses that profile. This is not portable-data mode.

Acquisition requires separately installed yt-dlp/post-archiver executables, selected
in Settings or resolved through the documented startup environment/PATH policy.
Signing, installers, updates and a public stable release remain future work.

To build with installed dependencies on Windows:

```powershell
npm.cmd run package -- --platform=win32 --arch=x64
npm.cmd run make -- --platform=win32 --arch=x64 --targets=@electron-forge/maker-zip
npm.cmd run test:packaged
```

See [packaging and profile safety](docs/PACKAGING.md), [verification](docs/TESTING.md)
and the [documentation map](docs/README.md). Development uses its own profile;
packaged smoke tests use disposable Windows profile environments.
