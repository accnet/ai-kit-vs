#!/usr/bin/env bash
# Validate the AI-Kit layouts without requiring a Git repository or YAML parser.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
fail=0
bad() { printf '  FAIL %s\n' "$1"; fail=1; }
ok() { printf '  ok   %s\n' "$1"; }

[[ -f .ai/node/ai-kit.ts ]] || bad ".ai/node/ai-kit.ts missing"
[[ -f .ai/node/package.json ]] || bad ".ai/node/package.json missing"
[[ -f .ai/scripts/ai-kit.sh ]] || bad ".ai/scripts/ai-kit.sh missing"
[[ -f .ai/scripts/install-node-runtime.mjs ]] || bad ".ai/scripts/install-node-runtime.mjs missing"
[[ -f .ai/kit.yaml ]] || bad ".ai/kit.yaml missing"
[[ -f .ai/engine/state-schema.md ]] || bad ".ai/engine/state-schema.md missing"
for adapter in .github/copilot-instructions.md .github/workflows/gates.yml .cursor/rules/ai-kit.mdc GEMINI.md .githooks/pre-commit; do
  [[ -s "$adapter" ]] || bad "$adapter missing or empty"
done

for role in .ai/agents/*; do
  [[ -d "$role" ]] || continue
  for doc in role input rules prompt checklist output; do
    [[ -s "$role/$doc.md" ]] || bad "$role/$doc.md missing or empty"
  done
done

while IFS= read -r tech; do
  for doc in overview patterns best-practices pitfalls examples; do
    [[ -s "$tech/$doc.md" ]] || bad "$tech/$doc.md missing or empty"
  done
done < <(find .ai/skills -mindepth 2 -maxdepth 2 -type d | sort)

for skill in .ai/skills/core/*; do
  [[ -d "$skill" ]] || continue
  [[ -s "$skill/SKILL.md" ]] || bad "$skill/SKILL.md missing or empty"
done

for workflow in .ai/workflows/*/workflow.md; do
  [[ -s "$workflow" ]] || bad "$workflow missing or empty"
done
for template in .ai/templates/*.md; do
  [[ -s "$template" ]] || bad "$template missing or empty"
done

[[ "$fail" -eq 0 ]] && { ok "all AI-Kit contracts are present"; exit 0; }
exit 1
