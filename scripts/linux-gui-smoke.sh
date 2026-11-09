#!/usr/bin/env bash
set -euo pipefail
# A real window manager is needed to acknowledge minimize/restore requests.
openbox >/tmp/moartube-openbox.log 2>&1 &
wm_pid=$!
trap 'kill "$wm_pid" 2>/dev/null || true; wait "$wm_pid" 2>/dev/null || true' EXIT
sleep 0.3
node "$@"
