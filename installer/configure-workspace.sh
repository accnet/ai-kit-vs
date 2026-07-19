#!/usr/bin/env bash
# Configure a project to use the shared AI-Kit device install.
set -euo pipefail

INSTALLER_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$(cd "$INSTALLER_DIR/.." && pwd)"
TARGET="$(pwd)"
KIT_HOME="${AIKIT_HOME:-$HOME/ai-kit}"
FORCE=0
DRY_RUN=0

usage() {
  cat <<EOF
Usage: bash installer/configure-workspace.sh [--target <workspace-root>] [--home <kit-home>] [--force] [--dry-run]

Configures a workspace to use the shared AI-Kit install in ~/ai-kit.
Creates .ai-work and compatibility files for VS Code, Copilot, Claude, Codex,
Cursor, and Gemini without copying the AI-Kit runtime into the workspace.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "--target requires a directory" >&2; exit 2; }
      TARGET="$(cd "$2" && pwd)"
      shift 2
      ;;
    --home)
      [[ $# -ge 2 ]] || { echo "--home requires a directory" >&2; exit 2; }
      KIT_HOME="$2"
      shift 2
      ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

TARGET="$(cd "$TARGET" && pwd)"
KIT_HOME="$(cd "$KIT_HOME" 2>/dev/null && pwd)" || {
  echo "AI-Kit home does not exist: $KIT_HOME (run the device installer first)" >&2
  exit 1
}
AIKIT_BIN="$KIT_HOME/bin/ai-kit"
[[ -x "$AIKIT_BIN" ]] || {
  echo "AI-Kit launcher is missing: $AIKIT_BIN (run the device installer first)" >&2
  exit 1
}
[[ "$TARGET" != "$SOURCE" ]] || { echo "Target cannot be the kit source directory." >&2; exit 2; }
[[ "$TARGET" != "$KIT_HOME" ]] || { echo "Target cannot be the AI-Kit home." >&2; exit 2; }
[[ -w "$TARGET" ]] || { echo "target directory is not writable: $TARGET" >&2; exit 1; }

declare -a SOURCES=(
  ".ai/templates/AGENTS.project.md"
  "CLAUDE.md"
  "GEMINI.md"
  ".github/copilot-instructions.md"
  ".cursor/rules/ai-kit.mdc"
  ".codex/config.toml"
  ".vscode/extensions.json"
  "installer/templates/vscode-settings.json"
  "installer/templates/vscode-tasks.json"
)
declare -a DESTINATIONS=(
  "AGENTS.md"
  "CLAUDE.md"
  "GEMINI.md"
  ".github/copilot-instructions.md"
  ".cursor/rules/ai-kit.mdc"
  ".codex/config.toml"
  ".vscode/extensions.json"
  ".vscode/settings.json"
  ".vscode/tasks.json"
)

CONFLICTS=0
for index in "${!SOURCES[@]}"; do
  source_path="$SOURCE/${SOURCES[$index]}"
  destination="$TARGET/${DESTINATIONS[$index]}"
  [[ -f "$source_path" ]] || { echo "missing installer asset: ${SOURCES[$index]}" >&2; exit 1; }
  if [[ -f "$destination" ]] && ! cmp -s "$source_path" "$destination" && [[ "$FORCE" -ne 1 ]]; then
    echo "conflict: ${DESTINATIONS[$index]}" >&2
    CONFLICTS=1
  fi
done
while IFS= read -r -d '' source_path; do
  relative="${source_path#$SOURCE/}"
  destination="$TARGET/$relative"
  if [[ -f "$destination" ]] && ! cmp -s "$source_path" "$destination" && [[ "$FORCE" -ne 1 ]]; then
    echo "conflict: $relative" >&2
    CONFLICTS=1
  fi
done < <(find "$SOURCE/.claude/commands" -type f -print0)
if [[ "$CONFLICTS" -eq 1 ]]; then
  echo "Installation stopped: use --force to replace listed workspace files." >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  printf '[dry-run] workspace: %s\n' "$TARGET"
  printf '[dry-run] kit home: %s\n' "$KIT_HOME"
  printf '[dry-run] would copy agent bridge and VS Code files\n'
  printf '[dry-run] would create .ai-work/{workflows,run,state} and default workflow state\n'
  exit 0
fi

for index in "${!SOURCES[@]}"; do
  source_path="$SOURCE/${SOURCES[$index]}"
  destination="$TARGET/${DESTINATIONS[$index]}"
  mkdir -p "$(dirname "$destination")"
  cp "$source_path" "$destination"
done
while IFS= read -r -d '' source_path; do
  relative="${source_path#$SOURCE/}"
  destination="$TARGET/$relative"
  mkdir -p "$(dirname "$destination")"
  cp "$source_path" "$destination"
done < <(find "$SOURCE/.claude/commands" -type f -print0)

mkdir -p \
  "$TARGET/.ai-work/state" \
  "$TARGET/.ai-work/run/workers" \
  "$TARGET/.ai-work/workflows/default/state" \
  "$TARGET/.ai-work/workflows/default/plan" \
  "$TARGET/.ai-work/workflows/default/roadmap" \
  "$TARGET/.ai-work/workflows/default/tasks" \
  "$TARGET/.ai-work/workflows/default/context" \
  "$TARGET/.ai-work/workflows/default/artifacts" \
  "$TARGET/.ai-work/workflows/default/logs"

if [[ ! -f "$TARGET/.ai-work/registry.json" ]]; then
  printf '{\n  "version": 1,\n  "revision": 0,\n  "workflows": []\n}\n' > "$TARGET/.ai-work/registry.json"
fi
if [[ ! -f "$TARGET/.ai-work/workflows/default/state/workflow.json" ]]; then
  (
    cd "$TARGET"
    "$AIKIT_BIN" init --title "Untitled workspace workflow" --workflow feature --actor planner >/dev/null
  )
fi

for template in plan roadmap tasks; do
  destination="$TARGET/.ai-work/workflows/default/$template/$template.md"
  if [[ ! -f "$destination" ]]; then
    cp "$SOURCE/.ai/templates/$template.md" "$destination"
  fi
done

gitignore="$TARGET/.gitignore"
marker="# AI-Kit workspace state"
if [[ ! -f "$gitignore" ]]; then
  printf '%s\n.ai-work/\n' "$marker" > "$gitignore"
elif ! grep -qF "$marker" "$gitignore"; then
  printf '\n%s\n.ai-work/\n' "$marker" >> "$gitignore"
fi

(
  cd "$TARGET"
  "$AIKIT_BIN" --state .ai-work/workflows/default/state/workflow.json validate >/dev/null
)

echo "AI-Kit workspace configured at $TARGET"
echo "Shared runtime: $KIT_HOME"
echo "Project state: $TARGET/.ai-work"
echo "Next: add tasks with 'ai-kit add-task ...' from the workspace root."
