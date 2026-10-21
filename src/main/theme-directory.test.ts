import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { copyFileSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ThemeDirectory } from './theme-directory';
import { ReaderRepository } from './persistence/reader-repository';
import { ReaderService } from './reader-service';
import { AppearanceAssets } from './appearance-assets';
import { builtinThemes, parseTheme, themeTemplates } from '../shared/appearance';
import type { ThemeDefinition } from '../shared/appearance';
import type { ReaderCallerContext } from './caller-context';

let root: string, repo: ReaderRepository, directory: ThemeDirectory;
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), 'theme-directory-'));
  repo = ReaderRepository.open(path.join(root, 'reader.sqlite')); directory = new ThemeDirectory(root);
});
afterEach(() => {
  vi.restoreAllMocks(); repo.close();
  if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith('theme-directory-')) throw Error('Unsafe cleanup');
  rmSync(root, { recursive: true, force: true });
});
const definition = (name = 'Editable'): ThemeDefinition => ({ ...builtinThemes.charcoal, name });
const file = (name: string) => path.join(directory.directory, name);
const put = (name: string, theme = definition()) => writeFileSync(file(name), JSON.stringify(theme));
function refresh() {
  const current = repo.readerAppearance();
  return directory.refresh(current.themes, themes => repo.replaceThemes(themes, ['en'], current.revision));
}
function service(openThemesFolder = vi.fn(async () => '')) {
  return new ReaderService(() => repo, ['en'], vi.fn(), undefined, {}, undefined, undefined, undefined, undefined, undefined,
    new AppearanceAssets(path.join(root, 'wallpapers'), { choose: async () => path.join(root, 'external.json'), encode: () => undefined, themes: directory, openThemesFolder }));
}
const caller = () => ({ isCurrent: () => true, windowId: repo.initialWindowId() }) as ReaderCallerContext;

it('materializes SQLite IDs and definitions once and supplies four examples without importing or overwriting them', () => {
  repo.importTheme(builtinThemes.dark, ['en'], 0);
  const before = repo.preferences(['en']), id = String(repo.readerAppearance().customThemeId);
  refresh(); expect(repo.preferences(['en'])).toEqual(before);
  expect(parseTheme(readFileSync(file(`${id}.json`), 'utf8'))).toEqual(builtinThemes.dark);
  expect(readdirSync(file('examples'))).toEqual(['charcoal.json', 'dark.json', 'light.json', 'warm-graphite.json']);
  for (const [name, template] of Object.entries(themeTemplates)) {
    expect(parseTheme(readFileSync(file(`examples/${name}.json`), 'utf8'))).toEqual(template);
  }
  writeFileSync(file('examples/light.json'), 'user-edited'); put(`${id}.json`, definition('Changed'));
  refresh(); expect(readFileSync(file('examples/light.json'), 'utf8')).toBe('user-edited');
  expect(repo.readerAppearance().themes).toEqual([{ id, definition: definition('Changed') }]);
  expect(repo.preferences(['en']).appearance).toBe('custom');
});
it('loads copied examples and additions, preserves rename identity, permits duplicate names and deletes the active file', () => {
  refresh(); copyFileSync(file('examples/light.json'), file('mine.json')); refresh();
  const id = repo.readerAppearance().themes[0].id;
  repo.updatePreferences({ selectTheme: { id, expectedRevision: repo.readerAppearance().revision } }, ['en']);
  repo.updatePreferences({ appearance: 'dark' }, ['en']);
  repo.updatePreferences({ selectTheme: { id, expectedRevision: repo.readerAppearance().revision } }, ['en']);
  expect(repo.preferences(['en']).appearance).toBe('custom');
  renameSync(file('mine.json'), file('renamed.json')); put('renamed.json', definition('Same name'));
  put('second.json', definition('Same name')); refresh();
  expect(repo.readerAppearance().themes[0]).toEqual({ id, definition: definition('Same name') });
  expect(new Set(repo.readerAppearance().themes.map(theme => theme.id)).size).toBe(2);
  unlinkSync(file('renamed.json')); refresh();
  expect(repo.preferences(['en']).appearance).toBe('system'); expect(repo.readerAppearance().customThemeId).toBeNull();
  refresh(); expect(existsSync(file('renamed.json'))).toBe(false);
});
it('keeps the last valid active snapshot for malformed, oversized and unsafe files while loading other valid files', () => {
  refresh(); put('active.json'); refresh(); const id = repo.readerAppearance().themes[0].id;
  repo.updatePreferences({ selectTheme: { id, expectedRevision: repo.readerAppearance().revision } }, ['en']);
  const before = repo.readerAppearance().themes[0];
  writeFileSync(file('active.json'), '{'); writeFileSync(file('bad.json'), '{}'); writeFileSync(file('large.json'), 'x'.repeat(16385));
  mkdirSync(file('directory.json')); put('valid.json', definition('Valid'));
  expect(refresh().issues.map(issue => issue.file).sort()).toEqual(['active.json', 'bad.json', 'directory.json', 'large.json']);
  expect(repo.readerAppearance().themes[0]).toEqual(before); expect(repo.preferences(['en']).appearance).toBe('custom');
  // Renaming an invalid file retains its identity and last valid palette too.
  renameSync(file('active.json'), file('broken-renamed.json')); refresh();
  expect(repo.readerAppearance().themes[0]).toEqual(before);
  put('broken-renamed.json', definition('Fixed')); refresh(); expect(repo.readerAppearance().themes[0].id).toBe(id);
});
it('preserves IDs for an unambiguous copy/delete rename and never merges identical new files', () => {
  refresh(); put('a.json'); refresh(); const id = repo.readerAppearance().themes[0].id;
  copyFileSync(file('a.json'), file('renamed.json')); unlinkSync(file('a.json')); refresh();
  expect(repo.readerAppearance().themes[0].id).toBe(id);
  // JSON object key order is not theme identity.
  const reordered = Object.fromEntries(Object.entries(definition()).reverse());
  unlinkSync(file('renamed.json')); writeFileSync(file('reordered.json'), JSON.stringify(reordered)); refresh();
  expect(repo.readerAppearance().themes[0].id).toBe(id);
  copyFileSync(file('reordered.json'), file('copy.json')); refresh(); expect(repo.readerAppearance().themes).toHaveLength(2);
});
it('retains the 16-theme limit, prioritizes known files and aborts oversized scans without accepting deletions', () => {
  refresh(); for (let n = 0; n < 16; n++) put(`theme-${n}.json`, definition(String(n))); refresh();
  put('aaa.json'); expect(refresh().issues).toEqual([{ file: 'aaa.json', reason: 'limit' }]);
  const before = repo.preferences(['en']); unlinkSync(file('theme-0.json'));
  for (let n = 0; n < 260; n++) writeFileSync(file(`ignored-${n}.txt`), '');
  expect(() => refresh()).toThrow('entry limit'); expect(repo.preferences(['en'])).toEqual(before);
});
it('recovers a backup into a new profile with IDs intact and never overwrites conflicting files', async () => {
  repo.importTheme(definition('Backed up'), ['en'], 0); refresh();
  const id = String(repo.readerAppearance().customThemeId), backup = path.join(root, 'backup.sqlite'); await repo.createBackup(backup);
  const otherRoot = path.join(root, 'other'); mkdirSync(path.join(otherRoot, 'themes'), { recursive: true });
  copyFileSync(backup, path.join(otherRoot, 'reader.sqlite'));
  writeFileSync(path.join(otherRoot, 'themes', `${id}.json`), JSON.stringify(definition('User copy')));
  const other = ReaderRepository.open(path.join(otherRoot, 'reader.sqlite')), files = new ThemeDirectory(otherRoot);
  try {
    files.refresh(other.readerAppearance().themes, themes => other.replaceThemes(themes, ['en'], other.readerAppearance().revision));
    expect(other.readerAppearance().themes).toContainEqual({ id, definition: definition('Backed up') });
    expect(other.readerAppearance().themes.some(theme => theme.id !== id && theme.definition.name === 'User copy')).toBe(true);
    expect(parseTheme(readFileSync(path.join(otherRoot, 'themes', `${id}-1.json`), 'utf8')).name).toBe('Backed up');
    expect(repo.readerAppearance().themes[0].definition.name).toBe('Backed up');
    unlinkSync(path.join(otherRoot, 'themes', `${id}.json`));
    files.refresh(other.readerAppearance().themes, themes => other.replaceThemes(themes, ['en'], other.readerAppearance().revision));
    expect(other.readerAppearance().themes).toEqual([{ id, definition: definition('Backed up') }]);
  } finally { other.close(); }
  const emptyRoot = path.join(root, 'restored'); mkdirSync(emptyRoot); copyFileSync(backup, path.join(emptyRoot, 'reader.sqlite'));
  const restored = ReaderRepository.open(path.join(emptyRoot, 'reader.sqlite'));
  try {
    new ThemeDirectory(emptyRoot).prepare(restored.readerAppearance().themes);
    expect(parseTheme(readFileSync(path.join(emptyRoot, 'themes', `${id}.json`), 'utf8')).name).toBe('Backed up');
  } finally { restored.close(); }
});
it('recovers either side of an interrupted SQLite commit without resurrecting deleted files', () => {
  refresh(); put('a.json'); refresh();
  unlinkSync(file('a.json'));
  expect(() => directory.refresh(repo.readerAppearance().themes, () => { throw Error('crash before commit'); })).toThrow();
  refresh(); expect(repo.readerAppearance().themes).toEqual([]); expect(existsSync(file('a.json'))).toBe(false);
  put('b.json'); refresh();
  const registry = JSON.parse(readFileSync(path.join(root, 'theme-files.json'), 'utf8'));
  unlinkSync(file('b.json'));
  let pending = '';
  directory.refresh(repo.readerAppearance().themes, themes => {
    pending = readFileSync(path.join(root, 'theme-files.json'), 'utf8');
    return repo.replaceThemes(themes, ['en'], repo.readerAppearance().revision);
  });
  writeFileSync(path.join(root, 'theme-files.json'), pending); // crash after COMMIT, before journal finalization
  expect(registry.entries).toHaveLength(1); refresh();
  expect(repo.readerAppearance().themes).toEqual([]); expect(existsSync(file('b.json'))).toBe(false);
});
it('rejects directory junction escapes and malformed registries without changing SQLite', () => {
  const outside = path.join(root, 'outside'); mkdirSync(outside);
  symlinkSync(outside, directory.directory, 'junction');
  expect(() => refresh()).toThrow('Unsafe theme directory'); expect(readdirSync(outside)).toEqual([]);
  unlinkSync(directory.directory); refresh(); put('a.json'); refresh(); const before = repo.preferences(['en']);
  writeFileSync(path.join(root, 'theme-files.json'), '{'); expect(() => refresh()).toThrow(); expect(repo.preferences(['en'])).toEqual(before);
});
it('rescans at startup, preserves edits across startup and retains SQLite when the directory is unavailable', async () => {
  repo.importTheme(definition('Old'), ['en'], 0); service(); const id = String(repo.readerAppearance().customThemeId);
  put(`${id}.json`, definition('Edited before restart')); service();
  expect(repo.readerAppearance().themes).toEqual([{ id, definition: definition('Edited before restart') }]);
  writeFileSync(file(`${id}.json`), '{'); service();
  expect(repo.readerAppearance().themes[0].definition.name).toBe('Edited before restart');
  const held = path.join(root, 'held'); renameSync(directory.directory, held); writeFileSync(directory.directory, 'blocked');
  const before = repo.preferences(['en']), s = service();
  expect(s.storageFailure).toBeUndefined(); expect(repo.preferences(['en'])).toEqual(before);
  expect(await s.dispatch('refreshThemes', [], caller())).toMatchObject({ error: { code: 'APPEARANCE_IMPORT_FAILED' } });
});
it('rejects hard-linked palette files and preserves externally edited copies after a failed import commit', () => {
  refresh(); const external = path.join(root, 'external.json'); writeFileSync(external, JSON.stringify(definition()));
  linkSync(external, file('linked.json'));
  expect(refresh().issues).toEqual([{ file: 'linked.json', reason: 'invalid' }]);
  expect(repo.readerAppearance().themes).toEqual([]);
  const before = readdirSync(directory.directory);
  expect(() => directory.add([], definition(), () => { throw Error('commit failed'); })).toThrow();
  expect(readdirSync(directory.directory)).toEqual(before);
  expect(() => directory.add([], definition('Formatting edit'), id => { writeFileSync(file(`${id}.json`), JSON.stringify(definition('Formatting edit'))); throw Error('commit failed'); })).toThrow();
  expect(() => directory.add([], definition(), id => { put(`${id}.json`, definition('Owner edit')); throw Error('commit failed'); })).toThrow();
  refresh(); expect(repo.readerAppearance().themes.map(theme => theme.definition.name).sort()).toEqual(['Formatting edit', 'Owner edit']);
});
it('does not recreate tracked missing files on restart and isolates a separate empty profile', () => {
  repo.importTheme(definition(), ['en'], 0); service(); const id = String(repo.readerAppearance().customThemeId);
  unlinkSync(file(`${id}.json`)); service(); expect(repo.preferences(['en']).appearance).toBe('system');
  expect(repo.readerAppearance().themes).toEqual([]); expect(existsSync(file(`${id}.json`))).toBe(false);
  const independentRoot = path.join(root, 'independent'); mkdirSync(independentRoot);
  const other = ReaderRepository.open(path.join(independentRoot, 'reader.sqlite'));
  try { new ThemeDirectory(independentRoot).prepare(other.readerAppearance().themes); expect(other.readerAppearance().themes).toEqual([]); }
  finally { other.close(); }
});
it('authenticates intents, opens only the fixed profile folder, copies imports/starters and emits shared commits', async () => {
  const open = vi.fn(async () => ''), s = service(open), changes: string[] = []; s.onSharedCommit(commit => changes.push(commit.change.kind));
  for (const operation of ['refreshThemes', 'openThemesFolder', 'saveThemeCopy'] as const) {
    expect(await s.dispatch(operation, operation === 'saveThemeCopy' ? [{ source: 'light' }] : [])).toMatchObject({ error: { code: 'FORBIDDEN' } });
    expect(await s.dispatch(operation, [{ path: 'arbitrary' }], caller())).toMatchObject({ error: { code: 'INVALID_REQUEST' } });
  }
  await s.dispatch('openThemesFolder', [], caller()); expect(open).toHaveBeenCalledExactlyOnceWith(directory.directory);
  const saved = await s.dispatch('saveThemeCopy', [{ source: 'warm-graphite' }], caller()); expect(saved.ok).toBe(true);
  expect(repo.preferences(['en']).appearance).toBe('system');
  writeFileSync(path.join(root, 'external.json'), JSON.stringify(definition('Imported')));
  expect((await s.dispatch('importTheme', [], caller())).ok).toBe(true);
  const id = String(repo.readerAppearance().customThemeId); expect(existsSync(file(`${id}.json`))).toBe(true);
  put(`${id}.json`, definition('Edited'));
  const result = await s.dispatch('refreshThemes', [], caller());
  expect(result).toMatchObject({ ok: true, value: { issues: [], preferences: { appearance: 'custom' } } });
  expect(repo.readerAppearance().themes.at(-1)?.definition.name).toBe('Edited'); expect(result.sync).toBeDefined();
  expect(changes).toEqual(['preferences', 'preferences', 'preferences']);
  vi.spyOn(s, 'nativeWritesAllowed').mockReturnValue(false);
  expect(await s.dispatch('refreshThemes', [], caller())).toMatchObject({ error: { code: 'DATA_BUSY' } });
  expect(await s.dispatch('saveThemeCopy', [{ source: 'dark' }], caller())).toMatchObject({ error: { code: 'DATA_BUSY' } });
  expect(await s.dispatch('refreshThemes', [], { ...caller(), isCurrent: () => false })).toMatchObject({ error: { code: 'FORBIDDEN' } });
});
