#!/usr/bin/env bash
# Runs the dashboard tool for the Claude skill. Brings the public app code into /tmp/dashboard
# (cloning it the first time in a chat, updating it after), checks Node, then runs
# claude/dash.mjs with this skill's config.json.
#   bash run.sh <command> [argument]
#   bash run.sh apply <<'EOF'
#   [{"op": "task", "title": "…"}]
#   EOF
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP=/tmp/dashboard
URL=https://github.com/George-Wightman/dashboard.git

if ! command -v node >/dev/null 2>&1; then
  echo "Node isn't available in this sandbox, so the dashboard can't be reached from here."
  exit 3
fi
if [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "This sandbox's Node is too old for the dashboard tool (it needs 18 or newer)."
  exit 3
fi

if [ -d "$APP/.git" ]; then
  if ! { git -C "$APP" fetch --quiet --depth 1 origin main && git -C "$APP" reset --quiet --hard origin/main; } 2>/dev/null; then
    echo "(Couldn't update the dashboard code; using the copy from earlier in this chat.)"
  fi
else
  rm -rf "$APP"
  if ! git clone --quiet --depth 1 "$URL" "$APP" 2>/dev/null; then
    echo "Can't reach GitHub from this sandbox. Check claude.ai → Settings → Capabilities: code execution on, and network access allowed."
    exit 3
  fi
fi

NODE_USE_ENV_PROXY=1 exec node "$APP/claude/dash.mjs" --config "$HERE/config.json" "$@"
