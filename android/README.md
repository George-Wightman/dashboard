# Dashboard widgets (Android)

Home-screen widgets for the dashboard: **Today** (the day as a short calendar), **Fuel**, **Hebrew**,
**Body**, **Goals**, **Countdown** and **This week**. Each is a small copy of a Daylight tile; a tap
opens that tile big in the dashboard (`?big=fuel`), and a tap on its time fetches it again.

## How it works

- The planner's web app (the same address as Claude's relay) answers `{"glance": key}` with a summary:
  for each widget a title, a number and caption, and a few lines (`js/glance.js`, `planner/glance.js`).
  It reads the dashboard and never writes it. What the widgets say is decided there, so changing the
  wording needs no new app.
- The app only lays that out (`app/src/main/java/.../Widgets.kt`), keeps the last answer for when
  there's no signal, and asks again at most every five minutes (Android wakes widgets every 30).
- The key lives in `glance.json` in the sync repo as a SHA-256. `node claude/glance-setup.mjs` makes a
  new one (the old stops working) and puts it in `calendar.widgets` in the dashboard's data, where
  **⚙ → Phone widgets → Connect** hands it to the app. Delete `glance.json` to switch the widgets off.

## Building

GitHub Actions builds it (`.github/workflows/android.yml`) on every push under `android/`: the unit
tests (which also draw every widget, day and night, into `shots/`), then an unsigned release build.
Both go to the `android-builds` branch.

It's signed on the laptop, with a key that never leaves it (`~/.dashboard-android/`):

    node android/sign.mjs

which downloads the latest unsigned build, signs it, and puts `Dashboard widgets.apk` in Google Drive
(`My Drive/Dashboard widgets/`). On the phone: open it from Drive, allow installs from Drive once, and
install. A newer build installs over the last (same key, higher version).
