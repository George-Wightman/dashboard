# Handoffs, and a tool a cheaper model can read — design

2026-09-16. Approved in brainstorming, question by question. Comes out of two handoff flags Claude
left on 15 and 16 September, both of which were silently cut off at 1000 characters before anyone
read them.

## Where this came from

George has been running the dashboard through Claude on claude.ai. Sonnet "just wasn't really
working the best"; Opus found and fixed what Sonnet had got wrong. He wants the cheaper model to be
enough: *"If that means we need to create a more detailed / guided experience for the claude agent
then that's what we need to do."*

The evidence says the model wasn't the whole story. Flag `#a601244f` claims the bundled skill docs
are stale against the live tool — 5 ops and 4 reads undocumented — and that this caused four
sessions of wrong work, including Claude telling George a cardio goal was impossible because "no
Hevy connector exists" when `run.sh gym` returns 96 workouts. Checked: `claude/skill/SKILL.md` and
`claude/skill/reference.md` in the repo document all 20 ops and all 15 reads, and are byte-identical
to the zip at `~/.dashboard-skill/dashboard-skill.zip`. The local build is current. What is stale is
the copy uploaded to claude.ai, and **nothing in the system can tell Claude that the map it was
handed is older than the tool it is calling.**

So the work splits in two: give Claude a way to tell us things that doesn't lose them, and stop it
holding a stale or silent-failing map in the first place.

Decisions:

- **Handoffs get their own channel**, as files in the sync repo — not flags. No length cap, no merge
  conflicts, and George's ⚑ panel stays his own notes rather than walls of dev text.
- **Both an automatic trail and written handoffs.** A weaker model cannot be relied on to notice it
  should report something, so the tool records its own failures regardless.
- **Docs come from the tool, not the upload.** `run.sh` already clones the current repo on every run.
- **Unknown fields warn; they do not reject.** George: *"we can put a pin in it and wait off."* The
  hard rejection is deferred until the trail shows what is actually worth rejecting.
- **Not doing:** reads that suggest next steps. Considered and dropped as the most verbose and least
  certain of the ergonomics options.

## 1. The handoff channel

A new op:

    {"op": "handoff", "title": "Stale bundled docs", "text": "…"}

`title` is required and short. `text` has **no cap** — this is the whole point of the channel, and
the reason it cannot live in `data.json`, where `addFlag` slices at `FLAG_TEXT_MAX`.

It writes a file to the sync repo at `handoffs/<YYYY-MM-DD>-<HHMM>-<slug>.md`, where the slug comes
from the title. `createGitHubClient` already takes a `path` (`js/sync.js:24`, defaulting to
`data.json`), so this is a second client on a different path, not new plumbing. The key already has
Contents read and write on the repo.

The file is markdown with frontmatter:

    ---
    at: 2026-09-16T08:14:00.000Z
    by: claude
    tool: <docs hash>
    app: dash-v9
    title: Stale bundled docs
    ---

    <text, verbatim>

Keeping handoffs out of `data.json` buys three things. There is no length cap to fight. They never
take part in the document merge, so a handoff written from a chat cannot collide with George's phone
syncing. And they never appear in the app's flags panel, which stays what it was: the notes George
makes himself with ⚑.

Nothing about the app changes. There is no UI for handoffs; they are Claude-to-developer.

### Reading and closing them

Two reads:

- `handoffs` — what is open: file name, title, when, who, and size, newest first. Says plainly when
  there are none.
- `handoff <name>` — one in full. Any unique start of the file name works, matching how ids already
  behave everywhere else in the tool.

Closing one moves it to `handoffs/done/`. The `handoffs` read lists only the open ones, so the
managing Claude can see what is still outstanding and does not re-report the same fault three
sessions running — which is what happened with the planner fault. Closing is a developer action, done
from a checkout rather than through the skill; no op exposes it.

## 2. The auto-trail

Every rejected op and every unknown command appends one line to `handoffs/trail.md`:

    2026-09-16T08:02:11Z · <docs hash> · apply op 2 of 3 · {"op":"dayOff","date":"2026-09-16"} · Unknown op "dayOff" — ops: task, habit, …

Rules:

- **Failures and field warnings only.** Never on a clean success, never on a read. A failure costs
  one extra GitHub round-trip at a moment when something has already gone wrong; a field warning
  costs one alongside a push that was happening anyway (the trail is a different path from
  `data.json`, so it cannot ride along with that write).
- **Capped.** The last 200 lines are kept; older ones are dropped as it writes.
- **Scrubbed.** The line goes through `scrubText` with the key in `secrets`, exactly as every other
  line the tool prints, so the key cannot reach the file.
- **Never fatal.** If the trail write fails, the tool says nothing about it and returns the original
  error. A failed trail must never turn a clear error message into a confusing one.

This is the half that does not depend on the model being self-aware. If Sonnet tries `dayOff` four
times and gives up without writing a word, all four attempts are still on record.

Note the interaction with `apply`'s all-or-nothing contract: a failed `apply` currently pushes
nothing. The trail is a separate file and a separate write, so recording the failure does not change
that contract — no part of the document is saved.

## 3. Live docs, and a handshake

Two changes, both aimed at the same thing: it should be impossible to work from a stale map without
being told.

**A `reference` read.** `run.sh` clones the repo to `/tmp/dashboard` on every run and resets it to
`origin/main`, so the current docs are always on disk next to the uploaded ones. `reference` prints
`claude/skill/reference.md` **from the clone**. Whatever zip George last uploaded, this is today's
reference.

**A build stamp.** `claude/build-skill.mjs` writes `dashboard/build.txt` into the zip, holding a hash
of `SKILL.md` and `reference.md`. `run.sh` hashes the cloned copies of those two files and compares.
When they differ it prints one line, before it runs anything else:

    The docs in this skill folder are older than the tool. Run `bash run.sh reference` for the current one.

Hashing the two doc files rather than the commit means it warns when the docs actually changed, not
on every unrelated commit — otherwise the warning appears constantly and stops being read.

The comparison lives in `run.sh`, not the CLI: it is about the skill folder, which the CLI is
deliberately not given (it receives only `--config`). A missing `build.txt` — an upload from before
this change — counts as a mismatch and warns, which is correct, since that is precisely the stale
case.

`run.sh` has computed the clone's hash by this point, so it passes it on as `--build <hash>`. That is
the value stamped into a handoff's `tool:` field and onto every trail line, and it is what lets a
handoff be read months later against the version of the tool that produced it. Run without `--build`
— directly, as the tests and a local checkout do — the CLI records `unknown` and carries on. The flag
is informational only; nothing branches on it.

After this, a stale upload costs one warning line instead of four sessions.

## 4. Unknown fields warn

Today only `planner` and `gym` check their field names (`claude/ops.js:535`). Every other op reads
the keys it knows and ignores the rest, so:

    {"op": "task", "title": "Gym", "length": "2h"}

succeeds, reports *Added task "Gym"*, sets no length, and Claude tells George it set one. Silent
wrong success is the worst failure mode for a weaker model, because nothing signals it to try again.

A shared helper checks each op's keys against a list of what that op accepts. Unknown keys **do not
fail the op**. They add a note after the op's own summary line:

    Added task "Gym" for Thu 17 Sep · #a1b2c3d4
    Note: "length" isn't a field on task — ignored. task takes: title, date, area, goal, minutes, time, notes, priority.

Each such note is also written to the trail, as its own line, marked as a warning rather than a
failure.

Nothing that works today stops working, so there is no risk on the morning George starts using this.
The model sees the field did not land and can correct it on the next call. And after a week of real
use the trail says which keys Sonnet actually fumbles, making the hard-reject version an informed
change rather than a guess.

`plan` carries nested objects — `goal`, `tasks`, `habits`, `targets` — and they are the sharpest case
of this, not an afterthought. Its nested shapes accept **much less** than the standalone ops they
resemble: a nested task reads only `title` and `date` (`claude/ops.js:205`), a nested habit only
`title` and `repeat`, a nested target only `title`, `target`, `unit` and `unitLabel`, and the goal
only `title`, `targetDate` and `why`. Everything else is dropped without a word.

That matters because SKILL.md tells Claude to put an `area` on every task and `minutes` on anything
over half an hour, so the planner can group and place it — and `plan` is what SKILL.md recommends for
exactly the bigger jobs where that guidance applies. A model following the instructions loses the
fields the instructions demand, and nothing says so. The nested lists are therefore checked against
what the nested shapes **actually read**, not against their standalone namesakes. Warning on
`minutes` inside a plan's task is correct and is the most useful warning in this section.

Where a shape has no clear owner, it is left unchecked rather than guessed at: a wrong warning is
worse than none, because it teaches the model to ignore the notes.

## 5. The task index

A table at the top of `reference.md`, mirrored in `help`, mapping intent to command — *what's on
today → `today`*, *give a task a length → `edit` with `minutes`*, *mark a day off → `off`*, *see
training → `gym`*. It covers the common intents, not all 35 commands; the full list stays below it.

The point is that a model should not have to hold 20 ops and 15 reads in its head to pick the right
one. This prevents the mistake that section 4 only catches.

## 6. Two fixes carried in

**All-day events block the day.** `planner/plan.js:143` filters all-day events out of `timed`
entirely, so an all-day "no work" event on a watched calendar is invisible and the planner books
straight through it — the fault reported in flag `#196d1690`. All-day, non-cancelled, non-`free`
events on watched calendars become busy time for the days they span. The existing `ignore` list
already keeps Holidays, Family and the rest out, so this does not black out ordinary all-day markers
on calendars the planner was never watching.

This is now partly covered by the `off` op, which hard-blocks time off. The calendar gap is still
worth closing: George should not have to remember that a calendar event will be ignored where the
dashboard's own time off would not.

**`flag` rejects over-long text.** `addFlag` (`js/data.js:313`) slices to 1000 characters silently.
`brief` and `guide` both reject over-long text with the limit named (`claude/ops.js:455`, `:467`);
`flag` is the odd one out, and it is the one that carried the handoffs. It gains the same treatment.
Less critical now that handoffs have their own uncapped channel, but `flag` is still what George's
own in-app ⚑ notes use, and the inconsistency is exactly the kind of thing that costs a session.

## Testing

Each piece gets tests alongside the existing suite, which runs the CLI against a fake GitHub
(`tests/helpers.js`, `tests/claude-*.test.js`) — so the handoff and trail writes are testable without
touching the real repo.

- **Handoffs** — the op writes the expected path and frontmatter; `text` of 5000 characters survives
  whole; `handoffs` lists open ones and not those under `done/`; `handoff <name>` resolves a unique
  prefix and says so plainly when a prefix is ambiguous or matches nothing.
- **Trail** — a failed op appends one line and pushes no document; a successful op appends nothing; a
  read appends nothing; the file is pruned to 200 lines; the key never appears in a written line,
  including when it is inside a rejected op's JSON; a trail write that throws leaves the original
  error unchanged and does not fail the command.
- **Handshake** — matching hashes print nothing; differing hashes print the warning; a missing
  `build.txt` warns. `build-skill` puts `build.txt` in the zip and the hash matches the files it
  shipped. `--build` is stamped onto handoffs and trail lines when given, and records `unknown` when
  it is not, without changing anything else the command does.
- **Field warnings** — a known field is silent; an unknown one warns, names the op's real fields, and
  leaves the record unchanged in every other respect; the op still succeeds; the warning reaches the
  trail. `plan`'s nested members warn against what they actually read: `minutes` and `area` on a
  plan's task warn, while `title` and `date` stay silent.
- **All-day events** — an all-day busy event on a watched calendar blocks its day; a `free` one does
  not; one on an ignored calendar does not; a timed event keeps behaving as it does today.
- **`flag`** — text over the cap is rejected with the limit named, and nothing is written.

## Order

The handshake and `reference` first: they are what makes every later session start from the right
map, and they are the smallest change. Then handoffs and the trail, which is the largest piece. Then
the task index, the two carried fixes, and the field warnings last — that one is the only piece with
any blast radius at all, and putting it last keeps it easy to drop if the morning demands it.

## What George does

Rebuild and re-upload the skill: `npm run build-skill`, then claude.ai → Settings → Capabilities →
Skills. Nothing in this design reaches the uploaded copy on its own, and until it is re-uploaded the
handshake is the only piece that can speak — which is, by design, exactly the thing it is there to
say.

## Pinned

- **Unknown fields rejecting rather than warning.** Revisit once the trail has a week of real use and
  says which keys are actually being fumbled.
