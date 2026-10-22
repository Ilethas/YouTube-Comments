import type { CommentProgress } from '../../shared/acquisition';

/** Bounded, main-only best-effort parser for yt-dlp extraction notes, not media
 * progress bars. Unknown formats stay indeterminate; diagnostics never leave here. */
export class YtDlpProgressParser {
  private line = '';
  private discarding = false;
  private warningTail = '';
  private fetched = -1;
  hasWarning = false;
  constructor(private readonly report: (progress: CommentProgress) => void) {}
  push(chunk: Buffer): void {
    // Only ASCII syntax is consumed; split UTF-8 diagnostics cannot become counts.
    const text = chunk.toString('utf8');
    const warningText = this.warningTail + text;
    this.hasWarning ||= /WARNING:/i.test(warningText);
    this.warningTail = warningText.slice(-7);
    for (const character of text) {
      if (character === '\r' || character === '\n') {
        if (!this.discarding) this.parse();
        this.line = ''; this.discarding = false;
      } else if (!this.discarding) {
        if (this.line.length === 1024) { this.line = ''; this.discarding = true; }
        else this.line += character;
      }
    }
  }
  end(): void { if (!this.discarding) this.parse(); this.line = ''; }
  private parse(): void {
    const match = /^\[youtube\]\s+(?:[A-Za-z0-9_-]+:\s+)?\s*Downloading comment(?: replies)? API JSON (?:page|reply thread) \d+\s+\((\d{1,16})(?:\/~?(\d{1,16}|\?|None|unknown))?\)\s*$/.exec(this.line);
    if (!match) return;
    const fetched = Number(match[1]), total = Number(match[2]);
    if (!Number.isSafeInteger(fetched) || fetched < this.fetched) return;
    this.fetched = fetched;
    this.report({ fetched, ...(Number.isSafeInteger(total) && total > 0 && total >= fetched ? { estimatedTotal: total } : {}) });
  }
}
