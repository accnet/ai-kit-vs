#!/usr/bin/env bash
# Health check for an AI-Kit project: runtime, contracts, config, state, and lock.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
fail=0
warn=0
ok() { printf '  ok   %s\n' "$1"; }
bad() { printf '  FAIL %s\n' "$1"; fail=1; }
note() { printf '  WARN %s\n' "$1"; warn=$((warn + 1)); }

AIKIT="bash .ai/scripts/ai-kit.sh"

echo "AI-Kit doctor - $ROOT"

# Required control-plane files.
for file in AGENTS.md .ai/kit.yaml .ai/rules.yaml .ai/registry.yaml .ai/models.yaml \
  .ai/security.yaml .ai/node/ai-kit.ts .ai/node/package.json .ai/scripts/ai-kit.sh; do
  [[ -f "$file" ]] && ok "$file" || bad "$file missing"
done
[[ -f README.md ]] && ok "README.md" || note "README.md missing (recommended, not required)"

# Node runtime must be installed for any command to run.
if [[ -d .ai/node/node_modules/tsx ]]; then
  ok "Node runtime installed"
else
  bad "Node runtime missing (run .ai/scripts/bootstrap.sh)"
fi

# CLI smoke test.
if version="$($AIKIT version 2>/dev/null)"; then
  ok "CLI responds ($(printf '%s' "$version" | tr -d '\n[:space:]'))"
else
  bad "CLI did not respond to 'version'"
fi

# Contract validation.
if bash .ai/scripts/check-kit.sh >/dev/null; then
  ok "kit contracts valid"
else
  bad "kit contract validation failed"
fi

# Capability manifests are readable.
if $AIKIT capabilities >/dev/null 2>&1; then
  ok "capabilities readable"
else
  note "capabilities not readable"
fi

# Workflow state (the default workflow lives under workflows/default/).
if [[ -f .ai-work/workflows/default/state/workflow.json ]]; then
  $AIKIT validate >/dev/null && ok "workflow state valid" || bad "workflow state invalid"
else
  note "workflow state not initialized (run .ai/scripts/bootstrap.sh)"
fi

# Reproducibility lock.
if [[ -f .ai/ai-kit.lock.json ]]; then
  if $AIKIT verify-lock >/dev/null 2>&1; then ok "lockfile matches runtime"; else note "lockfile drift (run 'ai-kit lock' to refresh)"; fi
else
  note "no lockfile (run 'ai-kit lock' to pin the runtime)"
fi

# Git hooks.
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  hooks=$(git config --get core.hooksPath || true)
  [[ "$hooks" == ".githooks" ]] && ok "Git hooks configured" || note "Git hooks not configured; run bootstrap.sh"
fi

# Verification commands declared in kit.yaml.
for key in test_command typecheck_command build_command lint_command; do
  cmd="$(awk -v key="$key" '$1 == key ":" {sub(/^[^:]*:[[:space:]]*/, ""); print; exit}' .ai/kit.yaml)"
  [[ -n "$cmd" ]] && ok "$key configured: $cmd" || note "$key not configured"
done

echo "summary: $fail failure(s), $warn warning(s)"
[[ "$fail" -eq 0 ]]
