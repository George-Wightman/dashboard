// How the tool reaches the sync repo: the app's own GitHub client (js/sync.js), with Claude's key.
// The one place that knows the route — everything else talks to { get, put } — so if claude.ai's
// sandbox ever blocks the API, only this file changes.

import { createGitHubClient } from '../js/sync.js';

export function makeClient({ token, repo, fetch }) {
  return createGitHubClient({ token, repo, ...(fetch ? { fetch } : {}) });
}
