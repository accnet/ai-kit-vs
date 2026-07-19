#!/usr/bin/env bash
# Bootstrap a project for AI-Kit: install the Node runtime, create the .ai-work
# data tree, wire Git hooks, initialize state, validate contracts, and lock.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

AIKIT="bash .ai/scripts/ai-kit.sh"

# 1. Node runtime — install .ai/node dependencies if they are missing.
if [[ ! -d .ai/node/node_modules/tsx ]]; then
  echo "Installing Node runtime dependencies..."
  node .ai/scripts/install-node-runtime.mjs --root .ai/node
fi

# 2. Project data tree (.ai-work holds DATA only; all logic lives in AI-Kit).
# One layout: every workflow (including "default") lives under workflows/<id>/,
# created on demand. Top level holds the active-workflow pointer and workers.
mkdir -p .ai-work/{workflows,run,state}

# 3. Git hooks (defense in depth; CI remains canonical).
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git config core.hooksPath .githooks
fi

# 4. Initialize or migrate the default workflow state.
DEFAULT_STATE=".ai-work/workflows/default/state/workflow.json"
LEGACY_STATE=".ai-work/state/workflow.json"
if [[ ! -f "$DEFAULT_STATE" ]]; then
  if [[ -f "$LEGACY_STATE" ]]; then
    mkdir -p "$(dirname "$DEFAULT_STATE")"
    cp "$LEGACY_STATE" "$DEFAULT_STATE"
    if [[ -f .ai-work/state/current.json ]]; then
      sed -i 's#\.ai-work/state/workflow\.json#\.ai-work/workflows/default/state/workflow.json#' .ai-work/state/current.json
    fi
  else
    $AIKIT init --title "Untitled workflow" --workflow feature >/dev/null
  fi
fi

# 5. Validate contracts and current state.
bash .ai/scripts/check-kit.sh
$AIKIT validate >/dev/null

# 6. Record a reproducibility lock if one is not present.
if [[ ! -f .ai/ai-kit.lock.json ]]; then
  $AIKIT lock >/dev/null
fi

echo "AI-Kit bootstrapped. Add tasks with: bash .ai/scripts/ai-kit.sh add-task ..."
echo "Check health with: bash .ai/scripts/doctor.sh"
