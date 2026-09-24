// A local folder (the Google Drive for desktop copy of My Drive) in DriveApp's shape, so the planner's
// Drive reader (planner/drive.js) can be tried against George's real files from this machine.

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const iter = (list) => { let i = 0; return { hasNext: () => i < list.length, next: () => list[i++] }; };

function folder(path, name) {
  const entries = () => readdirSync(path, { withFileTypes: true }).filter((d) => !d.name.startsWith('.'));
  return {
    getName: () => name,
    getFoldersByName: (n) => iter(entries().filter((d) => d.isDirectory() && d.name === n).map((d) => folder(join(path, d.name), d.name))),
    getFiles: () => iter(entries().filter((d) => d.isFile()).map((d) => {
      const p = join(path, d.name);
      return {
        getId: () => p, getName: () => d.name, getMimeType: () => '', getLastUpdated: () => statSync(p).mtime,
        getBlob: () => ({ getDataAsString: () => readFileSync(p, 'utf8') }),
      };
    })),
  };
}

export const localDrive = (root) => ({ getRootFolder: () => folder(root, 'My Drive') });
