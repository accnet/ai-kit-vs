#!/usr/bin/env bash
# Opt-in end-to-end smoke test of the full role chain using the REAL provider
# binaries configured in .ai/models.yaml (e.g. claude, codex). It proves the
# runtime drives planner -> executor -> qa -> reviewer -> close with actual CLIs.
#
# Requires the configured provider binaries to be installed and authenticated.
# Missing binaries are reported and the script exits without failing your build.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

AIKIT="bash .ai/scripts/ai-kit.sh"
WF="smoke-$(date +%s)"

# Which binaries do the configured plugins need? Read command[0] of each role's
# configured plugin and verify it is on PATH. The global home default is kept in
# sync with installer/home.ts; the old dot-home remains a compatibility fallback.
missing=()
for role in planner executor reviewer; do
  id="$(awk -v r="$role" '$1 == r":" {print $2; exit}' .ai/models.yaml)"
  [[ -z "$id" || "$id" == "any-capable-agent" ]] && { echo "models.yaml has no plugin for $role"; exit 0; }
  manifest=".ai/plugins/$role/$id.json"
  if [[ ! -f "$manifest" ]]; then
    manifest="${AIKIT_HOME:-$HOME/ai-kit}/plugins/$role/$id.json"
  fi
  if [[ ! -f "$manifest" ]]; then
    manifest="$HOME/.ai-kit/plugins/$role/$id.json"
  fi
  bin="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync('$manifest','utf8')).command[0])" 2>/dev/null || echo)"
  command -v "$bin" >/dev/null 2>&1 || missing+=("$role:$bin")
done
if [[ "${#missing[@]}" -gt 0 ]]; then
  echo "SKIP: provider binaries not on PATH: ${missing[*]}"
  echo "Install and authenticate them, then re-run to prove the real chain."
  exit 0
fi

echo "Running real provider chain for workflow '$WF'..."
$AIKIT workflow-create "$WF" --title "Smoke chain" --workflow feature >/dev/null

# Workers are detached, so every role must be waited on and checked before the
# next role starts. This keeps a successful exit meaningful and prevents a
# partially started chain from being reported as a pass.
worker_ids=()
cleanup() {
  for id in "${worker_ids[@]}"; do
    npm run --silent ai-kit:worker -- stop "$id" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT

start_worker() {
  local role="$1" output id
  output="$(npm run --silent ai-kit:worker -- start --workflow-id "$WF" --role "$role")" || {
    echo "ERROR: failed to start $role worker" >&2
    return 1
  }
  id="$(printf '%s' "$output" | node -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(value.id)')"
  worker_ids+=("$id")
  STARTED_WORKER_ID="$id"
  printf '%s worker: %s\n' "$role" "$id" >&2
}

wait_worker() {
  local role="$1" id="$2" timeout="${AIKIT_SMOKE_TIMEOUT_SECONDS:-120}" status record
  for ((second = 0; second < timeout; second++)); do
    record="$(npm run --silent ai-kit:worker -- status "$id")"
    status="$(printf '%s' "$record" | node -e 'const fs=require("fs"); process.stdout.write(JSON.parse(fs.readFileSync(0,"utf8")).status)')"
    case "$status" in
      stopped) return 0 ;;
      failed|exited)
        echo "ERROR: $role worker ended with status $status. WHY: detached provider failed or exited before completing its role. FIX: inspect .ai-work/run/workers/$id.log." >&2
        tail -40 ".ai-work/run/workers/$id.log" >&2 || true
        return 1
        ;;
    esac
    sleep 1
  done
  echo "ERROR: $role worker timed out. WHY: detached provider did not reach a terminal state within ${timeout}s. FIX: inspect .ai-work/run/workers/$id.log." >&2
  return 1
}

start_worker planner
PLANNER_WORKER="$STARTED_WORKER_ID"
wait_worker planner "$PLANNER_WORKER"
start_worker executor
EXECUTOR_WORKER="$STARTED_WORKER_ID"
wait_worker executor "$EXECUTOR_WORKER"
start_worker qa
QA_WORKER="$STARTED_WORKER_ID"
wait_worker qa "$QA_WORKER"
start_worker reviewer
REVIEWER_WORKER="$STARTED_WORKER_ID"
wait_worker reviewer "$REVIEWER_WORKER"

# The gate runner re-verifies the project and closes only reviewer-approved work.
npm run --silent ai-kit:gate -- "$WF" --once --verify >/dev/null

echo "--- status ---"
final_status="$($AIKIT --state ".ai-work/workflows/$WF/state/workflow.json" status)"
printf '%s\n' "$final_status"
node -e 'const s=JSON.parse(process.argv[1]); const total=Object.values(s.counts).reduce((sum,n)=>sum+n,0); if (!total || s.counts.done !== total) { console.error(`ERROR: smoke chain did not finish all tasks: ${JSON.stringify(s.counts)}`); process.exit(1); }' "$final_status"
echo "Inspect artifacts under .ai-work/workflows/$WF/artifacts/ for provider output."
