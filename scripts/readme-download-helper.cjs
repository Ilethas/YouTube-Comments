// Offline screenshot fixture, launched as a real Node child through the
// production process executor. It reports deterministic observations and waits
// for real cancellation/shutdown; it never requests YouTube or emits content.
if (process.argv.includes('--version')) {
  process.stdout.write('2026.08.19\n');
} else {
  const url = new URL(process.argv.at(-1));
  if (url.origin !== 'https://www.youtube.com' || url.pathname !== '/watch') throw Error('Unexpected fixture target');
  const observations = [[1755, 8721], [680, 3200], [238, 1480]];
  const index = (Number(url.searchParams.get('v').slice(-1)) - 1) % observations.length;
  const [fetched, total] = observations[index < 0 ? 0 : index];
  process.stderr.write(`[youtube] Downloading comment API JSON page 51 (${fetched}/~${total})\n`);
  setInterval(() => undefined, 1000);
}
