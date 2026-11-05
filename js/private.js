// Private JSON files beside data.json in the sync repo (money.json, london/areas.json): read with the
// same key, the last good copy kept on this device so the views work offline, like the map's files
// (js/map/files.js). A file that fails its check is ignored; a fetch that fails keeps the cache.

export function loadCached(storage, key, valid) {
  try {
    const saved = JSON.parse(storage.getItem(key));
    return saved && valid(saved.doc) ? saved.doc : null;
  } catch {
    return null;
  }
}

// `clientFor(path)` gives a { get } like js/sync.js's createGitHubClient: null when the file isn't there.
// Returns the file's document, or null when there's none (and then forgets the cached one).
export async function refreshFile({ clientFor, storage, key, path, valid }) {
  const file = await clientFor(path).get();
  const doc = file && valid(file.doc) ? file.doc : null;
  if (!file) {
    try { storage.removeItem(key); } catch { /* nothing kept */ }
    return null;
  }
  if (!doc) return loadCached(storage, key, valid);
  try { storage.setItem(key, JSON.stringify({ at: new Date().toISOString(), doc })); } catch { /* too big: this visit only */ }
  return doc;
}
