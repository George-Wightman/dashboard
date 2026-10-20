// A fetch made with curl, for the relay's last try (claude/relay.js). curl reads the sandbox's
// proxy settings itself, so it can get through when Node's fetch can't. POST only: the body goes in
// on stdin (data.json can be large), and -L follows Apps Script's redirect to its answer as a GET.

import { execFile } from 'node:child_process';

export function curlFetch(url, init = {}, { run = execFile } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['-sS', '-L', '--max-time', '60', '-w', '\n%{http_code}', '--data-binary', '@-'];
    for (const [k, v] of Object.entries(init.headers ?? {})) args.push('-H', `${k}: ${v}`);
    args.push(url);
    const child = run('curl', args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { reject(new Error(`curl failed: ${String(stderr || err.message).trim().slice(0, 200)}`)); return; }
      const cut = stdout.lastIndexOf('\n');
      const status = Number(stdout.slice(cut + 1)) || 0;
      const text = stdout.slice(0, cut);
      resolve({ status, ok: status >= 200 && status < 300, text: async () => text });
    });
    child.stdin?.end(init.body ?? '');
  });
}
