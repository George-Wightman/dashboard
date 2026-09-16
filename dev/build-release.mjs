// Content hashes make an interrupted or mixed deployment detectable before use.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function releaseManifest(read = (path) => readFileSync(new URL(path, root))) {
  const sw = String(read('sw.js')).replace(/\r\n/g, '\n');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const files = Object.fromEntries(shell.map((path) => [path, hash(read(path === './' ? 'index.html' : path))]));
  return { id: hash(JSON.stringify(files) + sw), files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = releaseManifest();
  writeFileSync(new URL('release.json', root), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Offline release ${manifest.id.slice(0, 12)} (${Object.keys(manifest.files).length} files)`);
}
