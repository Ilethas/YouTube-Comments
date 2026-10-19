import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

// Record rendered inputs, including dependencies whose package directories are
// removed by Forge. This asset is evidence for the offline distribution check.
export function noticeBundle(label: string): Plugin {
  return {
    name: 'notice-bundle-inputs',
    generateBundle(_options, bundle) {
      const modules = new Set<string>();
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const [id, info] of Object.entries(output.modules)) {
          if (info.renderedLength > 0) modules.add(id.replaceAll('\\', '/'));
        }
      }
      const packages = new Map<string, { name: string; version: string; modules: string[] }>();
      const generated: string[] = [];
      for (const id of [...modules].sort()) {
        const match = /^(.*\/node_modules\/)((?:@[^/]+\/)?[^/]+)\/(.*)$/.exec(id.replace(/^\0/, '').split('?')[0]);
        if (match) {
          const metadata = JSON.parse(fs.readFileSync(path.join(match[1], match[2], 'package.json'), 'utf8'));
          const key = `${metadata.name}@${metadata.version}`;
          const entry = packages.get(key) ?? { name: metadata.name, version: metadata.version, modules: [] as string[] };
          if (!entry.modules.includes(match[3])) entry.modules.push(match[3]);
          packages.set(key, entry);
        } else if (id.startsWith('\0')) generated.push(id.slice(1));
      }
      this.emitFile({ type: 'asset', fileName: `third-party-${label}.json`, source: JSON.stringify({
        packages: [...packages.values()].sort((a, b) => a.name.localeCompare(b.name)), generated,
      }, null, 2) + '\n' });
    },
  };
}
