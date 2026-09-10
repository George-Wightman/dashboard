# Task 15: Final verification and morning report

Part of [the core hub plan](../2026-09-10-core-hub.md) — read its Global Constraints first.

This task is for the **controller**. It is the last thing that happens before George wakes up.

**Files:**
- Create: `docs/screenshots/today-desktop.png`, `docs/screenshots/today-phone.png`,
  `docs/screenshots/today-dark.png`, `docs/morning-report-2026-09-11.md`
- Modify: `docs/superpowers/plans/2026-09-10-core-hub.md` (tick every finished task)

- [ ] **Step 1: Full test run**

Run: `npm test`
Expected: PASS. Copy the final summary lines (`# tests`, `# pass`, `# fail`) into the report.

- [ ] **Step 2: Screenshots with headless Chrome (or Edge)**

Keep the local server running (`python -m http.server 8080`). Each headless run uses a fresh
profile, so the seed page seeds and then redirects to the dashboard.

```powershell
$browser = @("C:\Program Files\Google\Chrome\Application\chrome.exe", "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
New-Item -ItemType Directory -Force docs\screenshots | Out-Null
& $browser --headless=new --disable-gpu --hide-scrollbars --window-size=1280,900 --virtual-time-budget=8000 --screenshot="$PWD\docs\screenshots\today-desktop.png" "http://localhost:8080/dev/seed.html?replace"
& $browser --headless=new --disable-gpu --hide-scrollbars --window-size=390,1400 --virtual-time-budget=8000 --screenshot="$PWD\docs\screenshots\today-phone.png" "http://localhost:8080/dev/seed.html?replace"
& $browser --headless=new --disable-gpu --hide-scrollbars --force-dark-mode --blink-settings=preferredColorScheme=0 --window-size=1280,900 --virtual-time-budget=8000 --screenshot="$PWD\docs\screenshots\today-dark.png" "http://localhost:8080/dev/seed.html?replace"
```

Open each PNG with the Read tool and check it against the spec's *Screen* section. If a
screenshot shows the seed page instead of the dashboard, raise `--virtual-time-budget` to 15000.
If something looks wrong, fix it (smallest change, with a commit), note it in the report, and
re-shoot.

- [ ] **Step 3: Last walkthrough in the Browser pane**

At desktop size, on seeded data: tick, untick, add a task, log `45m` to Job search, open and
close a history day, open the editor and Cancel, open settings and Cancel. Check for console
errors with `read_console_messages` (`onlyErrors: true`). Then do the same at the `mobile`
preset, and reset to `desktop`.

- [ ] **Step 4: Write `docs/morning-report-2026-09-11.md`**

Use exactly these sections, filled in with what actually happened. Be honest: anything skipped,
failing or uncertain is stated plainly.

```markdown
# Morning report — dashboard core hub

## Where it stands
<!-- One paragraph: is piece 1 done? Does it run? What's the one thing George should know first? -->

## What got built
<!-- Task-by-task list with commit hashes (`git log --oneline`). -->

## Tests
<!-- Final npm test summary. Any test that was changed from the plan, and why. -->

## Screenshots
![Desktop](screenshots/today-desktop.png)
![Phone](screenshots/today-phone.png)
![Dark mode](screenshots/today-dark.png)

## Decisions made without you
<!-- Everything decided that the plan or spec didn't cover. Start with these, which were decided while planning:
- Tests run under Node (`npm test`) instead of a `tests.html` page, because Node was installed.
- Goal numbers are plain counts (no time-based goals); weekly targets can be time or counts.
- Archived items have no "un-archive" button yet. They're kept, just not shown.
- Unknown top-level keys in the sync file are dropped. Future additions go on records instead.
- A task ticked on a day before its date never appears (edge case; can't happen through the UI).
Add anything else decided overnight. -->

## Known limitations and loose ends
<!-- Anything not working, not verified, or worth a second look. -->

## What you need to do this morning
<!-- The README's morning steps in short form, with a link to README.md. Stress that sync can't
be tested until the two repos and the key exist, and that the key never goes into chat. -->

## Next
<!-- Piece 2 (Hebrew auto-tick) is next per the roadmap. List any questions for George that came up. -->
```

- [ ] **Step 5: Tick the plan and commit**

In `docs/superpowers/plans/2026-09-10-core-hub.md`, change `- [ ]` to `- [x]` for every task that
was committed.

```bash
git add docs/
git commit -m "Add morning report and screenshots"
```

(End the commit message with the co-author line from the Global Constraints.)

- [ ] **Step 6: Hand it to George**

Send `docs/morning-report-2026-09-11.md` and the desktop screenshot with `SendUserFile`
(`status: "proactive"`). Keep the caption to one line: whether piece 1 is working, and that the
morning steps are in the report.
