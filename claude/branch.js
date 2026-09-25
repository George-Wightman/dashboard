// How a cloud routine saves. Anthropic's GitHub gateway lets a cloud session read the sync repo but
// write only to `claude/` branches — on 25 Sep the first deep run's PUT to data.json on main was
// refused, key or no key. So in a routine the tool reads the dashboard from main as usual and writes
// data.json and mind.json to a claude/ branch of its clone of the sync repo with git; the planner
// (planner/branches.js) merges that branch in on its next run, the way it merges any device.
//
// A client here has the { get, put } shape of js/sync.js's, so session.push and saveMind don't know
// the difference. get() is main merged with whatever the branch already holds, so a second save in
// the same run (or a run the planner hasn't merged yet) never drops the first. `git(args)` runs git
// in the clone and returns its output, throwing on failure; `files` reads and writes in the clone.

import { ConflictError } from '../js/sync.js';

const WHO = ['-c', 'user.name=Claude (the Coach\'s deep mind)', '-c', 'user.email=noreply@anthropic.com'];
const REJECTED = /non-fast-forward|fetch first|\[rejected\]|failed to push/i;

// The branch this session may push to: the one it's on when that's a claude/ branch, else the first
// claude/ branch it has, else claude/mind.
export function sessionBranch(git) {
  const current = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  if (current.startsWith('claude/')) return current;
  const local = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads/claude/']).split('\n').map((s) => s.trim()).filter(Boolean);
  return local[0] ?? 'claude/mind';
}

// The clone must be the sync repo, or a push could land anywhere.
export function checkClone(git, repo) {
  let url;
  try { url = git(['remote', 'get-url', 'origin']).trim(); } catch { url = ''; }
  const bare = url.replace(/\.git$/, '').toLowerCase();
  if (!bare.endsWith(`/${repo.toLowerCase()}`) && !bare.endsWith(`:${repo.toLowerCase()}`)) {
    throw new Error(`Can't find this routine's clone of ${repo} (looked for a git folder whose origin is ${repo}) — attach ${repo} to the routine`);
  }
}

export function createBranchWriter({ git, files, repo }) {
  checkClone(git, repo);
  const branch = sessionBranch(git);
  let fetched = false;
  let exists = false;

  // Whether origin has the branch, fetched once per save so a push that raced us is seen.
  function refresh() {
    try {
      git(['fetch', '--quiet', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
      exists = true;
    } catch {
      exists = false;
    }
    fetched = true;
  }

  function tip(path) {
    if (!fetched) refresh();
    if (!exists) return null;
    try { return JSON.parse(git(['show', `origin/${branch}:${path}`])); } catch { return null; }
  }

  function write(path, doc, message) {
    refresh();
    git(['checkout', '--quiet', '-B', branch, ...(exists ? [`origin/${branch}`] : [])]);
    files.write(path, JSON.stringify(doc));
    git(['add', path]);
    let staged = true;
    try { git(['diff', '--cached', '--quiet']); staged = false; } catch { /* something to commit */ }
    if (staged) git([...WHO, 'commit', '--quiet', '-m', message]);
    try {
      git(['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`]);
    } catch (e) {
      if (REJECTED.test(String(e?.message ?? e))) throw new ConflictError(`The ${branch} branch moved while saving`);
      throw new Error(`Couldn't push to ${branch} of ${repo}: ${String(e?.message ?? e).split('\n').filter(Boolean).slice(-2).join(' ')}`);
    }
    fetched = false;
    return git(['rev-parse', 'HEAD']).trim();
  }

  return {
    branch,
    // A { get, put } client for one file: reads main (through `main`), writes the branch.
    client({ main, path, merge }) {
      return {
        async get() {
          const fromMain = await main.get();
          const onBranch = tip(path);
          if (!onBranch) return fromMain;
          return { doc: fromMain ? merge(fromMain.doc, onBranch) : onBranch, sha: fromMain?.sha ?? null };
        },
        async put(doc) {
          return write(path, doc, `Coach's deep mind: ${path}`);
        },
      };
    },
  };
}
