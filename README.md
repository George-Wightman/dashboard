# Today — a personal dashboard

Open the laptop, it's already on screen: what have I got today, tick things off as I go.
One screen: today's list (tasks and habits), goals, Hebrew, the gym and the last three weeks.
Works offline and syncs between the laptop and the phone through a private GitHub repo. Planning
happens in a chat with Claude, which reads and changes everything here; the app asks one short
question about each piece of work as it's done or missed, and keeps the answer for Claude.

Pieces 1, 3 and 6 of 6: the core hub, the Claude skill and the calendar planner. The designs are in
[`docs/superpowers/specs/`](docs/superpowers/specs/), and the build plans are in
[`docs/superpowers/plans/`](docs/superpowers/plans/).

## Using it

- **Anything new goes through Claude:** a task for any day, a goal, a habit or a weekly target, in
  any Claude chat (below). There is no add box or + button.
- **Open a widget big:** click the heading of Gym, Hebrew or Last 3 weeks (a ⤢ shows on hover) for
  the long view that doesn't fit on the page. Gym adds a board of personal bests, the last year of
  sessions as a grid, and sets per muscle group week by week. Hebrew adds the whole ladder to the
  10-minute conversation — tick the conversations right there — and the last two weeks day by day.
  Last 3 weeks shows every week since you started, and each day with what was missed, by name.
  Escape, ✕ or a click outside closes it.
- **Check-ins:** see below.
- **Note for Claude:** the small box at the top of the widgets. Say it (the mic) or type it, then
  **Send** (or Ctrl+Enter): a thought for Claude to pick up next time you talk. It's a *For Claude*
  flag stamped with the time and whatever block you were in, and Claude's catch-up shows these
  first. The heading says how many are still waiting.
- **Countdown:** tell Claude "count down to the assessment centre on 5 October" and the days left
  show in the Countdown widget until the day. Nothing is booked for it.
- **Goals with a number and a date** say what it takes a day to finish on time, under the goal's
  line: *10 pages a day to finish by Thu 15 Oct*.
- **Logging:** tell Claude what you did ("sent two applications"). Cardio fills itself from Hevy and Google Health (runs in Strava or on the watch), and
  the Hebrew targets from the Hebrew app, so those are never logged by hand.
- **Editing:** click any row's title (or a target's name in *This week*) to edit it. Archive
  instead of deleting — history is kept. A habit done a number of times a week shows a dot for each
  time.
- **Unfinished tasks carry over** with an amber *from Tue* marker until they're done.
- **The day starts at 4am**, so a late night still counts as the day before (change it in ⚙).
- **Suggestions** from Claude or Gemini show dimmed at the top: ✓ to take one on, ✕ to dismiss it.
  Things Claude added because you asked carry a small Claude logo (Gemini's star on older ones the
  retired Coach added); hover it for who added it.
- **⚙ settings** open with the version at the top. Everything else (GitHub sync, Hebrew progress, the day,
  Gemini, notifications, the look, Claude's changes, backups) is folded away on one line each, showing what it's set to. Click a
  line to change it.

## The look

Paper & Ink by day, a darker Night version from the evening hour (⚙ → Look) until the day starts —
the same palette as the Hebrew app. ⚙ → **Look** picks *Follow the day* (the default), *Paper*, or
*Night*. The installed app's title bar changes to match, and it never flickers the wrong one on
load — the theme is set before the page even paints.

## Daylight

The default screen since 19 Oct 2026
([`docs/superpowers/specs/2026-10-18-daylight-health-design.md`](docs/superpowers/specs/2026-10-18-daylight-health-design.md)).
The classic screen is still there: ⚙ → **Look → Screen: Classic**, or for one visit add `?classic` to the
address.

- **One screen.** The tiles flow down two columns (three on a wide window) and each shows its key
  numbers; tap a tile's title or ⤢ for everything behind them.
- **The note for Claude** sits at the top, centred under the sky. In **Arrange** it can move under the
  day or in with the tiles.
- **The sky: how today is going.** The header is the sky for this moment: dawn, morning, midday,
  afternoon, golden hour, dusk or night. The sun sits on its arc at the time, worked out on the
  device from sunrise and sunset where you are, and the moon shows at night. Each of today's timed
  blocks is a dot on the arc, gold once done. Over it: the greeting, how much of the day is done,
  Claude's brief, time off and the planner's notes (× hides one for today), any warning, and sync, ⚑,
  Arrange and ⚙. ⚙ → **The day → Place** picks London or Salzburg; it follows the time zone by default.
- **Today: what to do.** One timeline, and the only place you tick. Rows with a calendar time sit at
  their time, with the calendar's own commitments (a shift, an appointment) greyed between them and a
  "now" line that moves. Everything without a time is under **Any time today**, where rows can still be
  dragged into order. A check-in waits at the top; tomorrow's blocks and **Tell Claude** come last. Rows
  keep everything they show on the classic list.
- **Tiles: how your aims are going.** Needs you (only when a calendar conflict or a task without a slot
  needs a decision, in plain words), Body (cardio this week as one big number, your lifts and today's
  session), Hebrew, Goals, Your weeks (a gold sun per day, fuller for a better day), Countdown and This
  week. ⤢ opens a tile big. **Arrange** drags tiles (↑ ↓ on touch and narrow windows), hides them and
  brings them back; the order is kept on this device and starts from your classic arrangement.

Where each classic widget went: Upcoming became Needs you plus the "Tomorrow" line; Note for Claude
became Tell Claude under the day; Gym, Muscles and Cardio trend became Body (Muscles and Cardio trend in
its big view); Last 3 weeks became Your weeks.

## Food

Snap a meal and get on with your day ([`docs/superpowers/plans/2026-10-18-food.md`](docs/superpowers/plans/2026-10-18-food.md)).

- **Snap a meal** on the Fuel tile, or a breakfast, lunch or dinner marker on the timeline (they show
  until that meal is logged). Take a photo, choose one, or just type or say what it was; a line about
  it ("a big one, cooked in oil") makes the estimate better than any photo can.
- **Gemini estimates** protein (the number that matters) and calories, each as a range, with the
  items it saw. Pick a portion (lighter, about right, bigger) and save. You can close the sheet at any
  point: it finishes on its own.
- **Usual meals.** Tick *Save as a usual meal* and it becomes a one-tap chip with exact numbers next
  time, with no photo and no estimate.
- **The Fuel tile** fills a plate towards your protein target (180 g), lists today's meals with their
  photos while this device has them, and gives the week's calories as an average against your
  maintenance figure (Claude sets it once there are two weeks of meals). Never a daily calorie target.
  Opened big: the last 14 days.
- **Offline, or Gemini busy:** the meal is kept and estimated when it can be. The tile says how many
  are waiting. Nothing is lost.
- **Photos** are shrunk on the device and kept there until the meal is estimated and a small copy
  (about 40 KB) is in the sync repo under `photos/YYYY/MM/`, then let go.
- **Claude** reads every meal with `food`, opens a photo with `photo <id>`, and corrects a big miss
  with a reason you'll see on the meal.

**Privacy.** A meal sends Gemini the photo, your line and the time, nothing else. On Google's free
tier they may use it to improve their products. Your watch data is never sent to Gemini.

**Trying it locally:** `?fakegemini=meal` answers every meal with a canned estimate; `meal-slow`,
`meal-nonsense`, `offline` and `quota` try the other paths.

## Coach

Claude coaches your training in a chat; the dashboard shows the plan and keeps a few fixed rules
([`docs/superpowers/plans/2026-10-18-coach.md`](docs/superpowers/plans/2026-10-18-coach.md)).

- **Ask Claude to plan your training.** It reads Hevy, your back mornings, your meals and your
  calendar, follows your own training rules (kept in the private sync repo as `notes/gym.md`, never
  in this public one), and writes each session onto a dated *Gym* task.
- **Each session goes into Hevy as a routine** in a folder called *Dashboard*, with the sets and
  weights filled in, within 10 minutes. Start it in Hevy and save: that ticks the session. Training
  a session early? Move its task to that day first, or tick it yourself. The
  calendar block lists the exercises, so they're on your phone and watch too.
- **The morning question.** Until 11:00 the day starts with "How's your back this morning?" (fine,
  stiff, sore or bad). One tap. A sore or bad morning puts a warning on a session with deadlifts or a
  heavy squat. Two sore mornings in a row leave Claude a note for the next plan.
- **Ready for more weight.** When you do every set of a lift at the weight, at the top of the reps,
  Claude sees it and adds weight next time.
- **Body** shows the next session and the week's back mornings; opened big, the coming sessions, 90
  mornings and what's ready for more weight.

Not medical advice: your own professionals have the final say.

## Arranging the widgets

Today's list always stays in the first column. Upcoming, Goals, Countdown, This week,
Hebrew, Gym and the rest are widgets you can put under the list (Goals and Upcoming start there) or
in the columns beside it — one column from 760px wide, two from 1500px. Charts keep a sensible size
when a widget is wide. Weekly targets aren't rows on the list: each shows in the widget it belongs to —
Cardio in Gym, the three Hebrew ones in Hebrew — and *This week* holds only the rest. A target in an
area on time off is paused: it isn't shown, and it doesn't count as behind. *This week* disappears
when it has nothing to show. Click **Arrange** in the header:

- **Drag** a widget's grip (⋮⋮) onto another to put it there, or onto a column's *Drop here* to
  send it to the end (under the list included). On a touch screen, or whenever the window only
  shows one widget column, ↑ ↓ buttons replace the grip; they step through the widgets in reading
  order, so ↑ on the top widget beside the list moves it under the list.
- **Hide** takes a widget out of the columns; it waits as a chip under *Add a widget* until you
  bring it back.
- **Done** (or Escape) leaves Arrange mode. The arrangement is saved as you go, kept separately on
  each device (the laptop and the phone can have their own).

## Check-ins

The Coach — a Gemini conversation in the app, with a background "mind" and a Claude routine behind it —
was retired on 26 September 2026 ([`docs/superpowers/specs/2026-09-26-checkins-design.md`](docs/superpowers/specs/2026-09-26-checkins-design.md)):
it couldn't plan well enough to be worth talking to, and Claude in a chat can. What stayed is the one
thing only something running in the background can do — ask about a piece of work at the moment it
happens.

- **When you tick a task**, a card at the top of Today asks *How did "…" go?*
- **When a task's calendar block ends and it isn't ticked**, the planner asks *"…" isn't ticked —
  what happened?* within ten minutes, and pings the phone (⚙ → Notifications; at most four a day,
  none from 22:30 to 07:00). Ticking it afterwards turns the question into *how did it go*.
- **Answer** with the mic (Chrome's own speech-to-text) or a line or two, then **Save** — or **Skip**.
  Your words are kept at once; Gemini then tidies them into two or three sentences beside them. With
  no key, offline, or when Gemini fails, your words alone are kept, and that's fine.
- **One question at a time**, oldest first, and only on its own day: a question that has lost its
  moment isn't asked the next morning. Habits don't ask; taking a tick off takes its question away.
- **Claude reads them**: `catchup` at the start of a chat shows everything since the last one — what
  was ticked and when, what wasn't, what you said, new flags, workouts, what you moved in Google
  Calendar — and `checkins` lists the last two weeks.

**The key.** Nothing to set up if the Hebrew app has a Gemini key saved on the same device (both apps
are served from `george-wightman.github.io`). Otherwise paste one into ⚙ → *Gemini*. Keys stay on the
device and are never synced. A summary is one Flash-Lite request.

**Privacy.** A summary sends Gemini the task's name and what you said. On Google's free tier they may
use it to improve their products.

**Trying it locally without a key.** On localhost, add `?fakegemini` to the address:
http://localhost:8080/?fakegemini. A canned summary stands in for Google and no key is read. Other
modes: `?fakegemini=slow`, `nokey`, `quota`, `down`, `offline`, `badkey` or `nonsense`.

**What's kept of the Coach.** Its old conversations, entries and digests stay in the data (a
conversation's messages still go after 30 days), and its handoffs are still flags. Nothing reads the
rest.

## Hebrew progress

Paste a fine-grained GitHub token (Contents read only) for the Hebrew app's own sync repo into
⚙ → *Hebrew progress*, and the goal *Hebrew* appears with a daily habit, three weekly targets
(learning time, speaking practice, words said live) and a ladder of milestones leading up to a
10-minute conversation — all filled in from the app's real numbers each time it syncs.

The **Hebrew widget** shows it in one place: the week as seven cells shaded by minutes practised,
the three targets as numbers (with the share of spoken reps the app marked right), the words the app
is teaching you by band (strong, progressing, weak, new), the next rung of the ladder with how far
along it is, and the words you most recently said live. Each sync keeps a small summary of this on
the goal (`hebrewNow`: the four ladder numbers, the latest bands, the last 14 days and the last 8
words said live), so the phone shows it too, without its own Hebrew token. The daily
habit ticks itself on any day the Hebrew app shows a session; the targets show real minutes, reps
and words against target the same way any other weekly target does. Read-only: the dashboard never
writes back to that repo, and this can never conflict with the Hebrew app's own sync. Once created,
the goal, habit, targets and stages are ordinary records — rename them, retarget them, or archive
them, and the sync leaves your changes alone; it only ever fills in what's missing.

**Duolingo** counts for less. Once the planner setting `duolingo` has your username (ask Claude), the
planner reads your public Duolingo profile on each run, with no login. Whatever XP your Hebrew course gained since
the last check goes on that day as a log on *Hebrew practice*. A day with Duolingo but no Hebrew Reader
session leaves the habit **unticked**: the day score, the map and the planner still count it as not
done. But the habit's streak survives it, the row shows the owl and the XP, the Hebrew widget's week
outlines the day instead of leaving it empty, and the evening push mentions it. Duolingo's history
before the first check needs a login, so it isn't filled in. ⚙ → *Hebrew progress* shows when it last
checked, or what went wrong.

**What the stages count, and why not "words known".** The app's library size is the obvious number
and the wrong one: it counts every entry whether or not it has ever been drilled, and it grows from
seeds and imports, with each word's own inflections nested inside it. So the ladder is built from
four things the app has already decided for itself and that cannot be padded:

- **Words held strong** — its own hardest SRS band: held for weeks *and* accurate on recently.
- **Words said live** — its ledger of words spoken unprompted and correctly to the coach.
- **Nodes perfected** — a node on the path turns gold when every word it teaches is both ready and
  has been said live. The app stamps that itself; the dashboard only counts the stamps.
- **Days practised** — days with a real session behind them.

Those four are interleaved with five conversation stages you tick by hand (greeting her, then 1-,
3-, 5- and finally 10-minute chats). A stage that has ticked stays ticked.

**The numbers are set from where you actually stand.** Each automatic stage starts life as "50 more
words strong" rather than a number picked in advance, and the first sync that finds real practice
history turns it into a fixed target that much above where you were that day — so no stage can
arrive already passed. That happens once and is recorded on the goal; retarget a stage afterwards
and it stays where you put it. Coach transcripts never leave the Hebrew app, so conversations are
counted by what they produced, never by how many you held.

## Optional task controls and goal reviews

Tasks and goals have a folded **More options** section in the editor. Add success criteria,
availability dates, an advisory deadline, context, location or energy level without crowding the
daily list. Claude can also configure tags, checklists, custom values and dependencies on existing
one-off tasks. Waiting tasks stay visible but do not count in the day's completion total or receive
new calendar bookings. Existing area, duration, time and priority controls still steer the planner.

**AI goal reviews** are off by default. Expand a goal and choose **Review progress with AI** for
one review, or set a review interval in its editor (0 disables future scheduling). The existing
Apps Script planner needs `GEMINI_KEY` in its Script Properties; a key saved only in the browser
does not configure the planner. Reviews use bounded evidence from the goal, its linked work and
recent outcomes to assess direction. Their proposed tasks remain suggestions until accepted.
There can be at most three unaccepted suggestions for a goal; reviews also avoid exact repeats of
declined tasks. Completed goals stop generating scheduled review requests.

Each goal can have one review request per logical day. The runner makes at most two goal-review
API calls per run and six per day across goals. Other existing AI features have separate limits.
A failed or interrupted call is not retried automatically; pending and failed states are visible.
Reviews and rule processing follow the planner's ten-minute schedule and pause when it is paused.
No live AI calls are made by tests.

**Simple follow-ups**, when useful: Claude can attach a small outcome form to a task and a rule
that creates a follow-up, reschedules an unfinished task, logs a reported amount, adds an attention
note or requests a goal review. The completion checkbox then asks for the relevant answers. Rules
use reported facts, have bounded actions, and cannot recursively generate more reports. Each
rule/report pair runs once, and a failed action rolls back that rule. **Settings → Claude →
Follow-up rules** lets you pause a rule. Open-ended practice planning stays in Claude.

Claude discovers these controls with `capabilities`, reads one record with `inspect`, and can use
`preview` to validate changes without saving. The focused `workflows` and `reviews` playbooks
explain the boundaries. Plans now retain task durations, areas and advanced details, and their
tasks link to the proposed goal. See [the implementation and expansion notes](docs/ai-controls-2026-09-17.md).

## Flags

⚑ in the header notes something to change — a bug, a rough edge, an idea — from inside the app,
along with what it was doing at that moment. It's grey most of the time, and turns teal only once
sync is set up and something hasn't reached GitHub yet.

- Click ⚑, check the **About** line (a one-line summary of the moment — the look, today's
  progress, sync), write a sentence, and press **Save** (or Ctrl+Enter). It's saved at
  once and a sync is asked for straight away.
- Above the box, pick what the flag is for: **Feature**, **Bug**, **For Claude** (something for
  Claude to pick up later) or **Note**. Each flag in the list shows its kind (change it right there)
  and who wrote it — *You*, Claude (its spark), a follow-up rule, or the retired Coach (Gemini's
  star; its handoffs are *For Claude*) — and the chips above the list show one kind at a time. Claude reads
  them grouped the same way (`flags`, or `flags feature`).
- The open flags list newest first, with **More details** (the captured context: window size, the
  arrangement and sync state — never a key or token, only whether one is set) and
  **Mark addressed**, which archives it — nothing is ever deleted.
- The panel's foot line says whether every flag has reached GitHub yet, with **Sync now** when one
  hasn't.

Flags ride the same sync as everything else, into `dashboard-sync/data.json`, ready for Claude to
read and act on later.

## Claude

Claude can read the dashboard and change anything in it from any claude.ai chat — on the web, in the
desktop app or on the phone — and from Claude Code. It's the way in: say `/dashboard`, "catch me
up", "plan my week", "add that to the dashboard", "what's on today?", "log 45m of Hebrew", "tick off
the CV task", "debrief the mock".

- **Every planning chat starts with a catch-up**: everything since the last one — each day's ticks
  and misses, what you said in your check-ins, new flags, workouts, your calendar edits — said back
  in a few lines, misses by name, and then what to change.
- **After a practice session**, "debrief" goes over it with you and leaves the lesson in the notes of
  the next task that practises the same thing.

- **What you ask for goes straight on**, marked with Claude's logo. **What Claude notices** — a to-do
  that comes up in a chat — arrives as a suggestion for ✓ or ✕, and a bigger job (an application,
  interview prep) as a suggested goal with its stages and first tasks.
- **Claude directs.** You tick things off and rename them; Claude runs the rest, with controls you
  don't need yourself: **time off** (days or hours, for everything or some areas — nothing gets booked,
  streaks are safe, dated tasks move on), **notes** under a task's title (the ≡ mark opens them),
  **a brief** at the top of your list, **priorities** (booked first, ★), **area colours** in your
  calendar, and hours for particular days.
- **⚙ → Claude** shows all of it: today's brief and earlier ones, time off, priorities and colours,
  the calendar planner, what needs attention, what Claude can do, and **every change Claude makes**,
  newest first, with *Details* (what changed, field by field) and **Undo**. Undo never overwrites
  something you've changed since — it says so instead. Details are kept for 30 days; the one-line
  summaries for good.
- **Planning your week.** Say "plan my week" and Claude spreads the week's work over the days, with
  lengths and areas; the calendar planner (below) books it.

**How it works.** The skill (`claude/skill/`) clones this public repo into Claude's sandbox and runs
`claude/dash.mjs`, a small command-line tool built on the app's own modules: it reads `data.json`
from `dashboard-sync`, makes the change through the same store and merge, logs it, and writes it
back — to the laptop and the phone, Claude is just a third device. Changes appear at their next sync.
Visible, idle devices check for changes periodically, with longer waits after failures. Sync
requests time out rather than leaving the app permanently stuck on “syncing”.

**Setting it up (once).**

1. Make Claude its own key on GitHub: a fine-grained token, *Only select repositories →
   `dashboard-sync`*, *Contents → Read and write*. Keep it separate from the devices' key, so it can be
   revoked on its own.
2. Put it in `~/.dashboard-skill/config.json` (copy `claude/skill/config.example.json` there). It lives
   outside this folder on purpose: this folder syncs to Google Drive, and the key shouldn't.
3. `npm run build-skill` → `~/.dashboard-skill/dashboard-skill.zip`.
4. Upload it at claude.ai → Settings → Capabilities → Skills, with code execution on.

**The relay (for the phone).** claude.ai's chats and Claude Code on the web can read the private
sync repo at best, never write it. So the planner script doubles as a relay: deployed as a web app,
its `doPost` makes the tool's GitHub requests with the planner's own key, for the sync repo's files
only. The tool tries GitHub first and switches to the relay the first time it's refused.

1. Paste the new `planner/apps-script/Code.gs` into the Apps Script editor, then *Deploy → New
   deployment → Web app*, execute as *Me*, access *Anyone*. Copy the web app address.
2. `node claude/relay-setup.mjs <that address>` — a fresh random key into
   `~/.dashboard-skill/config.json`, its SHA-256 into `relay.json` in the sync repo.
3. `npm run build-skill` and upload the zip. In claude.ai → Settings → Capabilities, let code
   execution reach `script.google.com` and `script.googleusercontent.com`.

Delete `relay.json` from the sync repo to switch the relay off; run step 2 again for a new key.

A new key (or a change to `SKILL.md` or `reference.md`) means building and uploading again. A change
to the tool itself doesn't: the skill always runs the version on GitHub.

## The calendar planner

Your dashboard, booked into your Google Calendar. A small script in your own Google account (the
*Dashboard planner*) runs every 10 minutes, and whenever one of your calendars changes:

- **Each task has its own named event.** Tasks fit individually around appointments, with long tasks
  split into numbered sessions. Area calendars and colours remain. Weekly target time beyond
  concrete tasks becomes separate unscheduled time — except Hebrew learning time, which counts what
  you did in the Hebrew app and is never booked. A task's length defaults to 30 minutes;
  add a length or set a time in the editor when it needs one.
- **Today and tomorrow are exact; later days are rough** — `~` and a paler colour — and at 20:00 each
  evening the day after tomorrow turns exact.
- **Blocks go on the calendar for their area** (Job search and Assessment centre on Application,
  Health on Gym), so they take your colours. Hebrew and Gym are your own events: moved off a clash,
  never copied.
- **When things change:** a shift on top of a block moves it, and a note under the date says so. Move
  a block yourself and it stays where you put it. Drag, rename or resize a single-task event and its linked task follows. Deleting a task event leaves the task unscheduled until you choose a new date/time.
- **When you tick:** during its block, the block ends at the tick; before it or later that day, it
  moves to end at the tick; part done, it says *1 of 2 done* and the rest gets a new slot; missed, it
  goes and the task gets a new slot.
- **On the list,** today's tasks show their time and follow the day's order. ⚙ → *Calendar planner*
  says when it last ran; the header warns if it stops.

**One shared plan:** Today and Upcoming use confirmed Calendar bookings. Upcoming shows
future tasks, external commitments, booking freshness, overflow dates and unscheduled work. Conflicting
Calendar/Dashboard edits wait for your choice. Event links open a task completion view.


Claude does the thinking: say **"plan my week"** and it spreads the week's work over the days, with
lengths and areas, and the calendar follows. Its settings (planning hours, calendars, linked habits)
change by asking Claude.

**Setting it up (once, about 10 minutes):**

1. GitHub → Settings → Developer settings → Fine-grained tokens → *Generate new token*: name it
   *Calendar planner*, *Only select repositories* → `dashboard-sync`, *Contents: Read and write*.
2. Go to [script.google.com](https://script.google.com) → *New project*, and name it *Dashboard
   planner*. In ⚙ Project Settings tick *Show "appsscript.json" manifest file in editor*. Replace the
   contents of `appsscript.json` and `Code.gs` with the two files in `planner/apps-script/`.
3. ⚙ Project Settings → *Script properties*: `GITHUB_TOKEN` (the token), `SYNC_REPO`
   (`George-Wightman/dashboard-sync`), and `GEMINI_KEY` if you'd like untagged tasks sorted into areas.
4. Back in the editor, choose `install` and press *Run*. Google asks for permission; *Google hasn't
   verified this app* is expected for a script of your own → *Advanced* → *Go to Dashboard planner* →
   *Allow*. Within 10 minutes your next 7 days fill in.

`pause`, `resume` and `removeAll` (every future block it made, then pause) run the same way. Updates
arrive by themselves: the script loads the planner from this site each time it runs.

### Week in review

From Saturday to Monday the first tile is the week: done against planned (day by day, as the day
score counts), every miss named with its day, anything pushed after the lock, the weekly targets with
numbers (Hebrew, cardio, protein days, sessions, sore mornings), and **Plan next week with Claude**,
which opens a chat that starts with the catch-up. Opened big: the week day by day.

### Nudges

A push before a miss, not after it, on every device with notifications on (the same ones check-ins
use). Fixed rules, at most four a day, none between 22:30 and 07:00, each once:

- **07:30:** "How's your back?", until you answer the morning question.
- **14:00:** lunch not logged yet (only once you snap meals at all).
- **20:00:** Hebrew short of the day's share of the week's target (an hour a day for 7 h).
- **Half an hour before a coach's session:** its time, and that the routine's in Hevy.

Tapping one opens the thing to do. Tell Claude to turn them off (`nudges: false`).

### Moving between London and Salzburg

The planner keeps booking in London time, and your phone shows every block in its own time, so
nothing needs changing when you travel. Each device notes the time zone it's in, and Claude's reads
start by saying where you are, so a time you give Claude in Salzburg ("the gym at 17:00") is booked as
your 17:00. A time you type in the app is your time too, and nudges and quiet hours follow your
phone's clock. The sky follows your device too (anywhere on Central European time is Salzburg).

## Hevy

The same script reads your Hevy workouts (Hevy Pro's API) every 10 minutes. The only thing it ever
writes to Hevy is the coach's sessions, as routines in your *Dashboard* folder (see Coach). It never
writes a workout and never touches your own routines. Hevy can't delete routines through its API, so
the few in *Dashboard* are reused for each new session.

- **A workout ticks Gym**, and the Gym block in your calendar moves to when you actually trained.
  Its cardio minutes count towards your Cardio target (Claude links it). Untick it and it stays
  unticked; edit or delete the workout in Hevy and the dashboard follows.
- **The Gym panel** (a widget — Arrange moves or hides it): the week, the Cardio target, and a card for
  each key lift (Squat and Bench Press to start) — estimated 1RM, PRs in gold, the trend with its
  projection towards a target, pace in kg a week — and today's session. Today's Gym row says *via
  Hevy* and when; a day in *Last 3 weeks* lists its workouts.
- **Claude sees it too**: `gym` has everything, and the catch-up a line for the week. Everything from
  before the week you connect only feeds the trends.

**Setting it up:** get your key at [hevy.com/settings?developer](https://hevy.com/settings?developer),
then in the *Dashboard planner* script → ⚙ Project Settings → *Script properties* → add `HEVY_KEY`
with the key as its value. That's all: the first runs copy your history, a few hundred workouts at a
time. ⚙ → Claude → *Gym* says how it's going.

## Updates

A push reaches every device on its own, with no version number to bump:

Before publishing source changes, run `npm run build` and `npm test`, and include the generated
`planner/planner.js` and `release.json` in the same release. The manifest contains hashes of every
offline asset; a missing or mismatched file prevents that release from replacing the working copy.

- **The header says so.** The app checks the site when it opens, whenever you come back to it,
  and every ten minutes while it's on screen. When a newer version is published it downloads all
  of it in the background, then shows **Update ready · reload** in the header. Nothing reloads by
  itself, so nothing half-typed is ever lost. Click it when you're ready.
- **⚙ → Version** says which build this device is running (by when it was published), and whether
  it's the newest. If it isn't, **Reload to update** is there too. *Recent changes* lists the last
  few commits, marking any that aren't on this device yet. For a minute or so after a push,
  GitHub Pages is still publishing it, and ⚙ says so.

It works from the date GitHub Pages stamps on every file when it publishes, compared with the
date on the copy this device is running (`js/version.js`). The GitHub key is never used for this;
the commit list comes from the public `dashboard` repo.
Open pages keep using their original complete release until navigation. Cache cleanup is limited
to dashboard caches, so other apps on the same origin keep their offline files.

## Morning steps (one-off setup, about 10 minutes)

1. **Publish the app.** The overnight build lives on the `core-hub` branch; merge it into `main`
   first. On GitHub, create a **public** repo called `dashboard` (no README). Then, in this
   folder:
   ```
   git checkout main
   git merge core-hub
   git remote add origin https://github.com/George-Wightman/dashboard.git
   git push -u origin main
   ```
   In the repo: *Settings → Pages → Deploy from a branch → `main` / `(root)` → Save*. After a
   minute it's live at **https://george-wightman.github.io/dashboard/**.
2. **Create the sync store.** Create a **private** repo called `dashboard-sync`. Tick "Add a
   README" so it isn't empty.
3. **Make an access key.** *GitHub → Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token.* Repository access: *Only select repositories →
   `dashboard-sync`*. Permissions: *Contents → Read and write*. Copy the token.
4. **Connect the laptop.** Open the site, then ⚙ → *GitHub sync* → Sync repo
   `George-Wightman/dashboard-sync`, and paste the key → Save. The header should change to *synced HH:MM*.
5. **Install it and start it on sign-in.** In Chrome, use the install icon at the right of the
   address bar (or ⋮ → *Cast, save and share → Install page as app*). Then press Win+R and type
   `shell:startup`. In the Start menu, right-click *Today* → *Open file location*, and copy that
   shortcut into the Startup folder.
6. **Phone.** Open the same address in Chrome → ⋮ → *Add to home screen*. Enter the same repo and
   key in ⚙.

Anything typed into a local test copy (`localhost`) doesn't carry over to the published site on
its own. Use ⚙ → *Export backup* there and *Import backup…* on the site.

## Running it locally

```
npm run build
python -m http.server 8080
```

Then open http://localhost:8080/. For sample data, open http://localhost:8080/dev/seed.html?replace
(this only works on localhost).

While editing locally, select **Application → Service workers → Bypass for network** in Chrome
or Edge DevTools, then reload after changes. This avoids serving a previously installed release.
Rebuild before testing offline behaviour; `npm run test:browser` uses a fresh browser profile for
that. The normal update offer only notices a change to `index.html` locally, because Python dates
each file separately; GitHub Pages redates every file on deployment.

## Tests

```
npm test
```

Node 24's built-in test runner. There are no dependencies to install. Every pure module (dates,
parsing, scheduling, streaks, history, merge) and the sync flow is covered, including two
simulated devices converging. So are the Gemini client, check-ins from the tick to the ping, and
Claude's catch-up. They run against a fake `fetch`, so no test ever calls Google. The look's inline `<head>`
script is checked against `resolveLook` for every hour and a spread of settings; the palette check
keeps every colour name in one vocabulary; the widget arrangement (`js/layout.js`) and the flag
context and cap (`js/flags.js`) are fully covered too. The Claude tool is tested end to end against a
fake GitHub: every read and op, all-or-nothing batches, London time on a UTC machine, Undo's rules,
and the key never appearing in its output.

Reliability tests also cover independent concurrent edits, conversation merging, malformed data,
request timeouts, interrupted calendar changes, Script Property limits, and complete offline
releases. CI runs `npm test` on pushes and pull requests, including generated-file freshness checks.

For browser checks, make Playwright available (or set `PLAYWRIGHT_MODULE` to its installed package
directory), then run `npm run test:browser`. Set `BROWSER_CHANNEL=msedge` to use installed Edge;
otherwise it uses Playwright's Chromium. With installed Chrome and no browser download:
`npm install --no-save playwright-core`, then `PLAYWRIGHT_MODULE=playwright-core BROWSER_CHANNEL=chrome
npm run test:browser`. This creates an isolated local server and browser profile, blocks external
requests, and checks editing, cross-tab updates, offline saves and recovery on the classic screen,
then Daylight: the sky, the note for Claude (and moving it in Arrange), the tiles, a big view, the
snap sheet, the Log Hebrew time shortcut and phone width.

## How it's built

Plain HTML, CSS and JavaScript modules, with no framework or runtime dependencies. A small build
script bundles the Apps Script planner and generates the offline release manifest.

| File | Job |
|---|---|
| `js/dates.js` | Day arithmetic, the 4am boundary, labels |
| `js/parse.js` | `45m` / `1.5h` parsing and display |
| `js/doc.js`, `js/data.js` | The document and the store (`localStorage`) |
| `js/schedule.js` | What's on a day, carry-over, streaks, weekly totals, history, goal progress |
| `js/merge.js`, `js/record.js` | Merging copies with per-field versions and conversation-message tombstones |
| `js/sync.js` | GitHub read/merge/write with retry, and the sync timer |
| `js/gemini.js` | The Gemini client: lite model first, fallbacks and retries, plain-English errors |
| `js/checkins.js`, `js/ui/checkin.js`, `planner/checkins.js` | Check-ins: the records and which are waiting, the card on Today with its mic, and the planner asking about missed blocks and pinging |
| `js/workflow.js`, `js/goal-review.js`, `planner/reviews.js` | Optional task controls, conditional follow-ups, and bounded goal reviews |
| `js/look.js` | Which look (Paper or Night) applies at a given moment |
| `js/layout.js` | The widget arrangement: normalise, move, nudge, hide, show |
| `js/flags.js` | A flag's captured context, its 4 KB cap, and the panel's readers |
| `js/version.js` | Which build this is, whether a newer one is live, and taking the update |
| `js/changes.js` | Claude's change log: what a change did, and the readers ⚙ uses |
| `js/calendar.js` | The calendar planner's records: its settings, today's times, its notes and health |
| `planner/webpush.js`, `planner/p256.js`, `planner/aes.js` | Web Push from Apps Script (RFC 8291/8292), with the curve and cipher it doesn't have |
| `js/push-client.js` | Turning notifications on and off on a device |
| `claude/` | The command-line tool and the skill Claude runs (`npm run build-skill` zips the skill) |
| `planner/` | The calendar planner: a pure planning core (`plan.js` and its parts), the Apps Script side (`gas.js`), bundled by `npm run build-planner` into `planner/planner.js`, which the loader in `planner/apps-script/` fetches |
| `js/ui/*.js`, `js/app.js` | The screen |
| `sw.js`, `release.json`, `manifest.webmanifest` | Complete, hash-checked offline releases and install |

Data lives in one JSON document: `items`, `goals`, `milestones`, `logs`, `journal` (check-ins,
Claude's briefs, and the retired Coach's conversations and digests), `flags` (notes of something to change), `changes` (what Claude
has changed, for ⚙ and Undo) and `calendar` (the calendar planner's settings, its day-by-day
bookings and its notes). `rules`, `outcomes`, `workflowRuns` and `reviews` hold optional controls,
reported facts and execution receipts. Nothing is ever
hard-deleted. Records are archived or tombstoned, so a sync can't bring back something removed on
another device. Settings (repo, access key, day start, Gemini key, check-in hour, look) stay on
each device and are never synced, and so do the widget arrangement (`dash_layout`) and the last
successful sync time (`dash_last_synced`).

Edits to different top-level fields merge independently. Concurrent edits to the same field use
timestamp order with a deterministic tie-break; nested objects and most arrays are one field.
Conversations merge individual messages and retain deletion markers until pruning. Reload all
devices after upgrading: older writers still use whole-record timestamps.

Imports and remote documents are validated before application. If local data is damaged, the
store recovers valid records, also consults `dash_data_previous`, and attempts to preserve the
original under `dash_data_corrupt`; a visible warning reports recovery. The previous-copy backup
is best effort and yields space to the main document when storage is full. Exported backups
remain useful for recovering earlier history.

## Roadmap

1. **Core hub** — built
2. **Hebrew auto-tick** — practice minutes from the Hebrew app's sync file — built
3. **Claude skill** — built
4. Job search + Notion — application counts and deadlines from the Job Tracker
5. ~~Gemini coach~~ — built, then retired on 26 Sep 2026 for check-ins and Claude
6. **Google Calendar** — the planner books the dashboard into your calendar — built
7. ~~The Coach's mind~~ — built, then retired with the Coach
8. **Check-ins** — a question on each tick and each missed block, by voice, kept for Claude — built
9. Google Health — the Pixel Watch's walks, sleep and heart, for Claude's catch-up
10. Hebrew both ways — session summaries in, your real week out as practice material
