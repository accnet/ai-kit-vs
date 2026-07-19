#!/usr/bin/env bash
# Explicit project-local AI-Kit installer.
set -euo pipefail

INSTALLER_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$(cd "$INSTALLER_DIR/.." && pwd)"
TARGET="$(cd "$SOURCE/.." && pwd)"
FORCE=0
DRY_RUN=0
source "$INSTALLER_DIR/lib.sh"

usage() {
  echo "Usage: bash installer/install-project.sh [--target <project-root>] [--force] [--dry-run]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --target)
      [[ $# -ge 2 ]] || { echo "--target requires a directory" >&2; exit 2; }
      TARGET="$(cd "$2" && pwd)"
      shift 2
      ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
done

[[ "$TARGET" != "$SOURCE" ]] || { echo "Target cannot be the kit directory." >&2; exit 2; }
NODE_BIN="$(aikit_require_node)" || exit 1

PM="${AIKIT_PM:-}"
if [[ -z "$PM" ]]; then
  if [[ -f "$TARGET/pnpm-lock.yaml" ]]; then PM=pnpm
  elif [[ -f "$TARGET/yarn.lock" ]]; then PM=yarn
  elif [[ -f "$TARGET/bun.lockb" || -f "$TARGET/bun.lock" ]]; then PM=bun
  else PM=npm
  fi
fi
command -v "$PM" >/dev/null 2>&1 || command -v "$PM.exe" >/dev/null 2>&1 || {
  echo "package manager '$PM' not found on PATH (set AIKIT_PM to override)." >&2
  exit 1
}
[[ -w "$TARGET" ]] || { echo "target directory is not writable: $TARGET" >&2; exit 1; }

PATHS=(CLAUDE.md GEMINI.md .ai .claude .cursor .codex/config.toml .githooks .github/copilot-instructions.md .github/workflows/gates.yml)
should_skip() {
  case "$1" in
    */.env|*/.env.*) [[ "$1" == *.example || "$1" == *.sample ]] || return 0 ;;
  esac
  return 1
}
FILES=()
for item in "${PATHS[@]}"; do
  source_path="$SOURCE/$item"
  [[ -e "$source_path" ]] || continue
  if [[ -d "$source_path" ]]; then
    while IFS= read -r -d '' file; do
      should_skip "$file" && continue
      FILES+=("$file")
    done < <(find "$source_path" -path '*/node_modules' -prune -o -type f -print0)
  else
    should_skip "$source_path" || FILES+=("$source_path")
  fi
done

CONFLICTS=0
for file in "${FILES[@]}"; do
  rel="${file#$SOURCE/}"
  dest="$TARGET/$rel"
  if [[ -f "$dest" ]] && ! cmp -s "$file" "$dest"; then
    echo "conflict: $rel" >&2
    CONFLICTS=1
  fi
done
if [[ "$CONFLICTS" -eq 1 && "$FORCE" -ne 1 ]]; then
  echo "Installation stopped: use --force to replace listed managed files." >&2
  exit 1
fi

for file in "${FILES[@]}"; do
  rel="${file#$SOURCE/}"
  dest="$TARGET/$rel"
  if [[ "$DRY_RUN" -eq 1 ]]; then echo "copy: $rel"; continue; fi
  mkdir -p "$(dirname "$dest")"
  cp "$file" "$dest"
done

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "write: AGENTS.md (minimal project orchestration guide)"
else
  cp "$SOURCE/.ai/templates/AGENTS.project.md" "$TARGET/AGENTS.md"
fi

if [[ "$DRY_RUN" -eq 0 ]]; then
  ignore="$TARGET/.gitignore"
  marker="# AI-Kit runtime state"
  if ! [[ -f "$ignore" ]] || ! grep -qF "$marker" "$ignore"; then
    printf '\n%s\n.ai-work/\nnode_modules/\n' "$marker" >> "$ignore"
  elif ! grep -qE '^node_modules/$' "$ignore"; then
    printf '\nnode_modules/\n' >> "$ignore"
  fi
  NODE=("$NODE_BIN")
  RUNTIME_SCRIPT="$TARGET/.ai/scripts/install-node-runtime.mjs"
  RUNTIME_ROOT="$TARGET/.ai/node"
  if [[ "$(uname -s)" == "Linux" && "$TARGET" == /mnt/* ]] && command -v node.exe >/dev/null 2>&1; then
    NODE=(node.exe)
    RUNTIME_SCRIPT="$(wslpath -w "$RUNTIME_SCRIPT")"
    RUNTIME_ROOT="$(wslpath -w "$RUNTIME_ROOT")"
  fi
  "${NODE[@]}" "$RUNTIME_SCRIPT" --root "$RUNTIME_ROOT" --pm "$PM"
  "${NODE[@]}" "$TARGET/.ai/node/node_modules/tsx/dist/cli.mjs" "$TARGET/.ai/node/ai-kit.ts" version >/dev/null
fi

echo "AI-Kit project runtime installed into $TARGET"
[[ "$DRY_RUN" -eq 1 ]] && echo "Node runtime dependencies will be installed into $TARGET/.ai/node on a non-dry run."
echo "Next: cd \"$TARGET\" && bash .ai/scripts/bootstrap.sh && bash .ai/scripts/doctor.sh"
