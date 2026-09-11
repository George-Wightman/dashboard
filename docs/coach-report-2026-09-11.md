# Coach report — sync diagnostics and the Gemini coach

## Where it stands

Both pieces are built, reviewed and tested locally: **189 tests pass**, and every screen state was
clicked through in a browser using a fake Gemini, so none of your quota was spent and no real key
was used. Nothing is online yet. The work is on the branch `gemini-coach`, which also contains the
sync fix. Publishing it takes three commands (below).

## First: the access key you pasted in chat

It's in the chat history, so treat it as exposed. Revoke it (GitHub → Settings → Developer
settings → Personal access tokens → Fine-grained tokens) and make a new one with the same settings.
Paste the new key **only** into the dashboard's ⚙. I never used the old one.

## 1. "Sync failing" now says why

- **In plain English.** A key GitHub refuses reads: "GitHub refused the access key — check it
  hasn't expired and has Contents read and write on …". A repo the key can't see reads: "GitHub
  can't see … with this key — check the repo name, and that the key was given access to that
  repo".
- **Readable on a phone.** When sync is failing, click the status in the header and ⚙ opens with
  the reason at the top. Hovering no longer matters.
- **The likely cause of your failure:** the key didn't have access to the private
  `dashboard-sync` repo. When you create the new key, choose *Only select repositories →
  dashboard-sync*, then *Repository permissions → Contents: Read and write*.

## 2. The Gemini coach

I took "build the api integration" to mean Gemini, as you first described it. The design is in
`docs/superpowers/specs/2026-09-11-gemini-coach-design.md`.

- **Evening check-in.** From 6pm (changeable in ⚙) the Coach panel at the top right offers a
  check-in. Gemini asks 2–3 questions built from what actually happened today. You answer in a
  line each and get short, specific feedback, plus at most two suggested tasks for tomorrow
  (marked "for Sat" etc.).
- **Shape with AI.** In Goals, describe a big goal in plain words. Gemini proposes milestones, up
  to two habits and up to two weekly targets. Everything arrives as suggestions you accept (✓) or
  dismiss (✕), never straight onto your list.
- **Weekly digest.** Early each week it writes a short summary of last week in the background:
  what went well, what slipped, one focus. You can read it under "Last week". It's saved in your
  synced data so Claude can read it later.
- **Your key.** It reuses the Gemini key you already saved in the Hebrew app. Both live at
  `george-wightman.github.io`, so the key is shared automatically on the same device. You can
  also set a separate key in ⚙. It never leaves the device except in calls to Google.
- **Quota.** It uses Flash-Lite first (about 500 requests a day), so it doesn't eat the Hebrew
  app's scarce Flash allowance. A check-in costs 2 requests, shaping a goal 1, the digest 1 a week.
- **Privacy.** Check-ins and shaping send a summary of your list to Google. On Google's free tier
  they may use it to improve their products. ⚙ says this too.

## Decisions made without you

- Gemini (not the Claude connector) was built as "the API integration".
- Every proposal from the coach is a suggestion (✓ / ✕), never added straight to your list.
- Flash-Lite goes first, to protect the Hebrew app's allowance.
- A check-in started on one device and finished on another is never overwritten by a copy that
  hasn't caught up. If that happens, you'll see "This check-in was changed on another device —
  here's what it says now."
- Replies from Gemini wait until you've stopped typing before they appear, so nothing you're
  halfway through typing gets wiped.
- The background digest is tried once per device per week, so a failing connection can't keep
  spending requests.
- The offline copy of the app now always fetches fresh files when you publish an update. Before,
  it could show an old version for a while.

## Known limitations

- Answers you've typed but not sent are kept only on the page, and are lost if you reload.
- If you accept a proposed goal on one device after dismissing it on the other, the goal comes
  back, but its proposed habits and targets stay dismissed.
- Real Gemini replies haven't been tested — only the fake — because that needs your key and
  quota. If something reads oddly, send me the wording and I'll tune the prompts.

## What to do

1. Revoke the exposed key, and create a new one as described above.
2. Publish (in the Dashboard folder):
   ```
   git checkout main
   git merge gemini-coach
   git push
   ```
3. Open https://george-wightman.github.io/dashboard/, reload twice, and paste the new GitHub key
   into ⚙. If sync still fails, click the status for the reason and send it to me.
4. After 6pm, try the check-in. If the Hebrew app has a Gemini key on that device, it just works.
