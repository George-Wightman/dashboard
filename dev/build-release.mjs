// Content hashes make an interrupted or mixed deployment detectable before use.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const root = new URL('../', import.meta.url);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Pages serves what git holds, which is LF. A Windows checkout's working copy can be CRLF, and hashing
// that published hashes no served file matched, so every device refused the update (2 Nov 2026).
const TEXT = /\.(js|mjs|css|html|json|webmanifest|svg|txt|md)$|^\.\/$/;
const served = (path, bytes) => (TEXT.test(path) ? Buffer.from(String(bytes).replace(/\r\n/g, '\n')) : bytes);
export function releaseManifest(read = (path) => readFileSync(new URL(path, root))) {
  const sw = String(read('sw.js')).replace(/\r\n/g, '\n');
  const shell = [...sw.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  const files = Object.fromEntries(shell.map((path) => [path, hash(served(path, read(path === './' ? 'index.html' : path)))]));
  return { id: hash(JSON.stringify(files) + sw), files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = releaseManifest();
  writeFileSync(new URL('release.json', root), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Offline release ${manifest.id.slice(0, 12)} (${Object.keys(manifest.files).length} files)`);
}
