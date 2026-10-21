import path from 'node:path';
import { constants, closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { exactProperties, parseTheme, themeByteLimit, themeId, themeTemplates } from '../shared/appearance';
import type { ReaderAppearance, ThemeDefinition, ThemeFileIssue } from '../shared/appearance';

type Themes = ReaderAppearance['themes'];
interface Entry { id: string; file: string; identity: string; digest: string }
interface Registry { version: 1; entries: Entry[]; pending?: { hash: string; entries: Entry[] } }
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value, (_key, child: unknown) => child && typeof child === 'object' && !Array.isArray(child)
  ? Object.fromEntries(Object.entries(child).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : child)).digest('hex');
const safeName = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 240 && /\.json$/iu.test(value)
  && !/[\\/:]/u.test(value) && [...value].every(character => character.charCodeAt(0) >= 32);
const validEntries = (value: unknown): value is Entry[] => Array.isArray(value) && value.length <= 16
  && value.every(entry => exactProperties(entry, ['id', 'file', 'identity', 'digest']) && themeId(entry.id) && safeName(entry.file)
    && typeof entry.identity === 'string' && /^[0-9]+:[0-9]+$/u.test(entry.identity) && typeof entry.digest === 'string' && /^[a-f0-9]{64}$/u.test(entry.digest))
  && new Set(value.map(entry => entry.id)).size === value.length && new Set(value.map(entry => entry.file.toLowerCase())).size === value.length;

/** Bounded synchronous operations keep file publication and SQLite CAS in one
 * main turn. The sidecar is an association journal, never a theme authority.
 * Its pending mapping recovers either side of a crash at the SQLite COMMIT. */
export class ThemeDirectory {
  readonly directory: string;
  private readonly registry: string;
  constructor(private readonly profile: string) {
    if (!path.isAbsolute(profile)) throw Error('Absolute profile required');
    this.directory = path.join(profile, 'themes');
    this.registry = path.join(profile, 'theme-files.json');
  }
  private folder(directory: string): void {
    mkdirSync(directory, { recursive: true });
    if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()
      || realpathSync(directory) !== path.join(realpathSync(this.profile), path.relative(this.profile, directory))) throw Error('Unsafe theme directory');
  }
  private read(file: string, limit = themeByteLimit): { text: string; identity: string } {
    const parent = path.dirname(file);
    const checkParent = () => {
      if (parent !== this.profile && (lstatSync(parent).isSymbolicLink()
        || realpathSync(parent) !== path.join(realpathSync(this.profile), path.relative(this.profile, parent)))) throw Error('Unsafe theme parent');
    };
    checkParent();
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 || stat.size > limit
      || realpathSync(file) !== path.join(realpathSync(path.dirname(file)), path.basename(file))) throw Error('Unsafe theme file');
    const fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const current = fstatSync(fd);
      checkParent();
      if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino || current.size !== stat.size) throw Error('Changed theme file');
      const bytes = Buffer.alloc(current.size + 1), length = readSync(fd, bytes, 0, bytes.length, 0), after = fstatSync(fd);
      checkParent();
      if (length !== current.size || after.size !== current.size || after.mtimeMs !== current.mtimeMs) throw Error('Changed theme file');
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)), identity: `${current.dev}:${current.ino}` };
    } finally { closeSync(fd); }
  }
  private save(value: Registry): void {
    this.folder(this.directory);
    const temporary = path.join(this.profile, `.theme-files-${randomUUID()}.tmp`);
    try {
      const fd = openSync(temporary, 'wx');
      try { writeFileSync(fd, JSON.stringify(value)); fsyncSync(fd); } finally { closeSync(fd); }
      renameSync(temporary, this.registry);
    } finally { if (existsSync(temporary)) unlinkSync(temporary); }
  }
  private load(themes: Themes): Entry[] {
    if (!existsSync(this.registry)) return [];
    const value: unknown = JSON.parse(this.read(this.registry, 32768).text);
    if (!value || typeof value !== 'object') throw Error('Invalid theme registry');
    const r = value as Registry;
    if (!(exactProperties(r, ['version', 'entries']) || exactProperties(r, ['version', 'entries', 'pending'])) || r.version !== 1 || !validEntries(r.entries)
      || Object.hasOwn(r, 'pending') && (!exactProperties(r.pending, ['hash', 'entries']) || typeof r.pending.hash !== 'string'
        || !/^[a-f0-9]{64}$/u.test(r.pending.hash) || !validEntries(r.pending.entries))) throw Error('Invalid theme registry');
    return r.pending?.hash === hash(themes) ? r.pending.entries : r.entries;
  }
  private create(definition: ThemeDefinition, id: string): string {
    this.folder(this.directory);
    // Never replace an existing file, including links and invalid/user-edited JSON.
    for (let n = 0; n < 32; n++) {
      const file = `${id}${n ? `-${n}` : ''}.json`;
      try {
        const fd = openSync(path.join(this.directory, file), 'wx');
        try { writeFileSync(fd, `${JSON.stringify(definition, null, 2)}\n`); fsyncSync(fd); } finally { closeSync(fd); }
        return file;
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    throw Error('Theme filename conflicts');
  }
  private entry(id: string, file: string, definition: ThemeDefinition): Entry {
    return { id, file, identity: this.read(path.join(this.directory, file)).identity, digest: hash(definition) };
  }
  /** Recovery only materializes IDs absent from the registry. A tracked missing
   * file is a deletion; its stale SQLite definition must never recreate it. */
  prepare(themes: Themes): Entry[] {
    this.folder(this.directory);
    const examples = path.join(this.directory, 'examples'); this.folder(examples);
    for (const [name, definition] of Object.entries(themeTemplates)) {
      try { writeFileSync(path.join(examples, `${name}.json`), `${JSON.stringify(definition, null, 2)}\n`, { flag: 'wx' }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
    }
    const entries = this.load(themes).filter(entry => themes.some(theme => theme.id === entry.id));
    for (const theme of themes) if (!entries.some(entry => entry.id === theme.id)) {
      const canonical = `${theme.id}.json`;
      // Adopt an orphaned materialization only if it is still identical. A
      // restore collision preserves BOTH the SQLite definition and existing file.
      let identical = false;
      try { identical = hash(parseTheme(this.read(path.join(this.directory, canonical)).text)) === hash(theme.definition); } catch { /* Exclusive suffix below. */ }
      const file = identical ? canonical : this.create(theme.definition, theme.id);
      entries.push(this.entry(theme.id, file, theme.definition));
    }
    this.save({ version: 1, entries });
    return entries;
  }
  private commit<T>(before: Entry[], entries: Entry[], themes: Themes, action: () => T): T {
    this.save({ version: 1, entries: before, pending: { hash: hash(themes), entries } });
    const value = action();
    // A failed final journal write is recoverable from pending + committed hash.
    try { this.save({ version: 1, entries }); } catch { /* Next operation recovers pending. */ }
    return value;
  }
  add<T>(themes: Themes, definition: ThemeDefinition, action: (id: string) => T): T {
    if (themes.length >= 16) throw Error('Theme limit');
    const before = this.prepare(themes), id = randomUUID(), file = this.create(definition, id);
    const entries = [...before, this.entry(id, file, definition)];
    try { return this.commit(before, entries, [...themes, { id, definition }], () => action(id)); }
    catch (error) {
      // Remove only our still-unedited copy after a failed SQLite commit.
      try {
        const current = this.read(path.join(this.directory, file));
        if (current.identity === entries[entries.length - 1].identity && current.text === `${JSON.stringify(definition, null, 2)}\n`) unlinkSync(path.join(this.directory, file));
      } catch { /* Preserve edits. */ }
      throw error;
    }
  }
  refresh<T>(previous: Themes, action: (themes: Themes) => T): { value: T; issues: ThemeFileIssue[] } {
    const before = this.prepare(previous), files: string[] = [];
    const directory = opendirSync(this.directory);
    try {
      for (let n = 0; ; n++) {
        const entry = directory.readSync(); if (!entry) break;
        if (n >= 256) throw Error('Theme directory entry limit');
        if (/\.json$/iu.test(entry.name)) files.push(entry.name);
      }
    } finally { directory.closeSync(); }
    files.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    const parsed = files.map((file): { file: string; identity?: string; definition?: ThemeDefinition } => {
      if (!safeName(file)) return { file };
      try {
        const read = this.read(path.join(this.directory, file));
        try { return { file, identity: read.identity, definition: parseTheme(read.text) }; }
        catch { return { file, identity: read.identity }; }
      }
      catch {
        try {
          const stat = lstatSync(path.join(this.directory, file));
          if (stat.isFile() && !stat.isSymbolicLink()) return { file, identity: `${stat.dev}:${stat.ino}` };
        } catch { /* Missing/unreadable entries are individually rejected. */ }
        return { file };
      }
    });
    const entries: Entry[] = [], themes: { id: string; definition: ThemeDefinition }[] = [], issues: ThemeFileIssue[] = [];
    const used = new Set<string>();
    // Existing identities have priority over additions at the 16-theme boundary.
    for (const old of before) {
      let found = parsed.find(file => file.file === old.file);
      if (!found) {
        const matches = parsed.filter(file => !used.has(file.file) && !before.some(entry => entry.file === file.file)
          && ('identity' in file && file.identity === old.identity || file.definition && hash(file.definition) === old.digest));
        if (matches.length === 1) found = matches[0];
      }
      if (!found || used.has(found.file)) continue;
      used.add(found.file);
      if (found.definition) {
        entries.push(this.entry(old.id, found.file, found.definition)); themes.push({ id: old.id, definition: found.definition });
      } else {
        entries.push({ ...old, file: found.file });
        const snapshot = previous.find(theme => theme.id === old.id); if (snapshot) themes.push(snapshot);
        issues.push({ file: found.file, reason: 'invalid' });
      }
    }
    for (const file of parsed) if (!used.has(file.file)) {
      if (!file.definition) { issues.push({ file: file.file, reason: 'invalid' }); continue; }
      if (entries.some(entry => entry.file.toLowerCase() === file.file.toLowerCase())) { issues.push({ file: file.file, reason: 'invalid' }); continue; }
      if (themes.length >= 16) { issues.push({ file: file.file, reason: 'limit' }); continue; }
      const id = randomUUID(); themes.push({ id, definition: file.definition }); entries.push(this.entry(id, file.file, file.definition));
    }
    return { value: this.commit(before, entries, themes, () => action(themes)), issues };
  }
}
