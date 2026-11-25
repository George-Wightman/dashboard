// The Sunday letter's one notification (js/letter.js). Claude's Sunday routine writes
// letters/letters.json in the sync repo; when the newest letter is still news and hasn't been sent,
// this sends it to his devices once, opening the dashboard on it. Looks at most every
// LETTER_LOOK_MIN minutes, since a letter lands once a week and each look is a GitHub read.
// `request(url, init) → { status, text }`; `send(message) → true when delivered`.

import { LETTERS_PATH, latestLetter, letterFresh } from '../js/letter.js';

export const LETTER_LOOK_MIN = 20;

export function createLetterPush({ request, props, send, now, today, log = () => {} }) {
  const get = (k) => props.get(k) || null;
  function run() {
    const t = now().getTime();
    if (t - (Number(get('LETTER_LOOKED')) || 0) < LETTER_LOOK_MIN * 60000) return null;
    props.put('LETTER_LOOKED', String(t));
    const res = request(`https://api.github.com/repos/${get('SYNC_REPO')}/contents/${LETTERS_PATH}`, { method: 'GET',
      headers: { Authorization: `Bearer ${get('GITHUB_TOKEN')}`, Accept: 'application/vnd.github.raw+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`GitHub ${res.status} reading ${LETTERS_PATH}`);
    let file = null;
    try { file = JSON.parse(res.text); } catch { return null; }
    const letter = latestLetter(file);
    if (!letter || get('LETTER_SENT') === letter.id || !letterFresh(letter, today)) return null;
    // Marked first: one try, never a notification every ten minutes.
    props.put('LETTER_SENT', letter.id);
    const ok = send({ title: 'Your week', body: letter.title.slice(0, 140), url: './?big=letter', tag: `letter:${letter.id}` });
    log(`Sunday letter ${letter.id}: ${ok ? 'sent' : 'no device to send to'}`);
    return ok ? `letter ${letter.id} sent` : null;
  }
  return { run };
}
