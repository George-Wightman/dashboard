# Stocks routine: where it runs and how its cost is measured (spike, 12 Nov 2026)

## Options

| | Desktop scheduled task (`mcp__scheduled-tasks__*`) | Cloud routine (`RemoteTrigger`) |
| --- | --- | --- |
| Runs with the laptop off | No. It runs while the Claude desktop app is open; a missed run starts at the next launch. | Yes. |
| Web search | Yes (a normal Claude Code session). | Yes. |
| Reaching the sync repo | Directly: the skill CLI with `~/.dashboard-skill/config.json`, as every laptop chat does. | Only through the relay, with a relay key stored as a cloud secret, or git through the cloud's GitHub access. Neither has been tried yet. |
| Tokens per run | Exact: the run's transcript (`~/.claude/projects/<project>/<session>.jsonl`) has a `usage` block on every reply (input, cache creation, cache read, output). | Not exposed: the run log is a condensed event list. |
| Share of weekly usage | `mcp__ccd_session_mgmt__get_usage` returns the plan's weekly "% used". Reading it at the start and end of a run gives the run's share directly. Noisy if another session is working at the same time. | No equivalent seen. |

## Decision

**Desktop scheduled task.** It is the only host where each run's cost can be measured, which George
asked for. It also writes through the existing CLI, with no new key to hand out.

Each run records two figures in `meta.runs`:
- `tokens`: the sum over the run's transcript. A small script, `claude/run-tokens.mjs <session id>`, reads it.
- `pct`: the weekly "% used" at the end of the run minus the figure at the start. This is the number to compare with the 5% target.

**Cost of the choice:** a morning when the laptop app isn't open gets its brief when the app next
opens, not by 08:00. If George would rather have the brief on time, without the per-run
measurement, the cloud host is the fallback, measured by the two-week meter check instead. He is
asked in Task 8 before the schedules are made.

**Budget note:** the account is on the Pro plan. 5% of a Pro week is small, so the routine uses
Sonnet and keeps to the caps. The first two weeks of `pct` figures decide whether the caps hold.

The planned 2-minute test run was not made: Task 8's first real run checks the same things, and
using the measurement path for real is the better test.
