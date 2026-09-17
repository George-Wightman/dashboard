// Text files in the sync repo, beside data.json: how handoffs and the failure trail are written.
// The document client in js/sync.js speaks JSON on one fixed path; this speaks text on any path and
// can list a directory. Same repo, same key, same API — but nothing here touches the document, so a
// handoff can be any length, never takes part in the merge, and can't collide with George's phone.

import { encodeBase64, decodeBase64, accessError } from '../js/sync.js';

const API = 'https://api.github.com';

export function createFileStore({ token, repo, fetch = (...args) => globalThis.fetch(...args) }) {
  const url = (path) => `${API}/repos/${repo}/contents/${String(path).split('/').map(encodeURIComponent).join('/')}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  // The same plain-English cause js/sync.js gives for a bad or under-scoped key; everything else
  // keeps GitHub's own message, with the path, since that is what tells you which write failed.
  async function fail(res, path) {
    let message = '';
    try { message = (await res.json())?.message ?? ''; } catch { /* no body */ }
    if (res.status === 401 || res.status === 403) return accessError(repo, message);
    return new Error(`GitHub ${res.status} on ${path}${message ? `: ${message}` : ''}`);
  }

  const store = {
    // The files directly in a directory. One that doesn't exist is simply empty: nothing has been
    // written there yet, which is an answer rather than a problem to report.
    async list(dir) {
      const res = await fetch(url(dir), { headers, cache: 'no-store' });
      if (res.status === 404) return [];
      if (!res.ok) throw await fail(res, dir);
      const body = await res.json();
      if (!Array.isArray(body)) return [];
      return body
        .filter((f) => f.type === 'file')
        .map((f) => ({ name: String(f.name), path: String(f.path), size: Number(f.size) || 0 }));
    },

    async read(path) {
      const res = await fetch(url(path), { headers, cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw await fail(res, path);
      const body = await res.json();
      if (Array.isArray(body) || !body.content) return null;
      return { text: decodeBase64(body.content), sha: body.sha };
    },

    // Writing over a file needs its sha, so read first. These files have one writer at a time, so
    // there is no conflict dance to do here — unlike the document, which two devices share.
    async write(path, text, message) {
      const existing = await store.read(path);
      const res = await fetch(url(path), {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, content: encodeBase64(text), ...(existing ? { sha: existing.sha } : {}) }),
      });
      if (!res.ok) throw await fail(res, path);
      return (await res.json()).content.sha;
    },

    // Write then delete, in that order: interrupted halfway the file still exists in both places,
    // which is recoverable, where the other order would lose it.
    async move(from, to) {
      const file = await store.read(from);
      if (!file) throw new Error(`No file at ${from}`);
      await store.write(to, file.text, `move ${from} to ${to}`);
      const res = await fetch(url(from), {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `move ${from} to ${to}`, sha: file.sha }),
      });
      if (!res.ok) throw await fail(res, from);
    },
  };

  return store;
}
