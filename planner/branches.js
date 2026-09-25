// What Claude's routine left for the dashboard. A cloud routine can read the sync repo but write only
// to claude/ branches (Anthropic's GitHub gateway; see claude/branch.js), so a deep run pushes its
// data.json and mind.json to one, and every planner run looks for claude/ branches whose tip it
// hasn't taken in yet. Their files come back here; gas.js merges data.json into the dashboard and the
// Mind merges mind.json — the way any device's changes arrive, field by field, newest wins.
//
// `merged` is { branch: sha } of tips already taken in (the CLAUDE_MERGED script property), so an
// unchanged branch costs one small request a run. A tip is read by its sha, so a push landing
// mid-read is simply taken in next time.

import { createGitHubClient } from '../js/sync.js';
import { isDoc } from '../js/doc.js';
import { isMind } from '../js/mind-state.js';

const API = 'https://api.github.com';

// → { found: [{ branch, sha, data, mind }], problems: [text] }. One branch that can't be read is a
// problem for the log, and the rest are still taken in; it's tried again next run.
export async function claudeBranches({ fetch, token, repo, merged = {} }) {
  const res = await fetch(`${API}/repos/${repo}/git/matching-refs/heads/claude/`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} when looking for Claude's branches`);
  const refs = await res.json();
  const out = [];
  const problems = [];
  for (const r of Array.isArray(refs) ? refs : []) {
    const branch = String(r?.ref ?? '').replace(/^refs\/heads\//, '');
    const sha = r?.object?.sha;
    if (!branch.startsWith('claude/') || !sha || merged[branch] === sha) continue;
    const read = async (path) => {
      const got = await createGitHubClient({ token, repo, path, ref: sha, fetch }).get();
      return got?.doc ?? null;
    };
    try {
      const data = await read('data.json');
      const mind = await read('mind.json');
      out.push({ branch, sha, data: isDoc(data) ? data : null, mind: isMind(mind) ? mind : null });
    } catch (e) {
      problems.push(`${branch}: ${e?.message ?? e}`);
    }
  }
  return { found: out, problems };
}

// The CLAUDE_MERGED property once a run has saved what it took in.
export function mergedAfter(merged, found) {
  const next = { ...merged };
  for (const b of found) next[b.branch] = b.sha;
  return next;
}
