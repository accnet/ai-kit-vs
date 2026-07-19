#!/usr/bin/env bash
# Global AI-Kit installer (Linux/macOS).
# Installs the shared runtime, knowledge, and config into ~/ai-kit and creates
# launchers for the CLI, workers, gates, and plugins. Per-project state stays in
# each project's .ai-work/.
set -euo pipefail

# The installer ships inside the kit; SOURCE is the repo root (its parent).
INSTALLER_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$(cd "$INSTALLER_DIR/.." && pwd)"
# shellcheck source=installer/lib.sh
source "$INSTALLER_DIR/lib.sh"

TARGET="${AIKIT_HOME:-$HOME/ai-kit}"
FORCE=0
DRY_RUN=0
NO_DEPS=0

usage() {
  cat >&2 <<EOF
Usage: bash installer/install.sh [--home <dir>] [--force] [--dry-run] [--no-deps]

Installs AI-Kit into ~/ai-kit (override with --home or AIKIT_HOME).
  --force     Overwrite an existing install.
  --dry-run   Show what would happen without writing.
  --no-deps   Skip installing Node runtime dependencies.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --home)
      [[ $# -ge 2 ]] || { echo "--home requires a directory" >&2; exit 2; }
      TARGET="$2"
      shift 2
      ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-deps) NO_DEPS=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

# --- Preflight: require Node >= 22 before touching the filesystem. ---
NODE_BIN="$(aikit_require_node)" || exit 1

# Shared runtime + knowledge + config that belong in the global home.
PAYLOAD=(AGENTS.md CLAUDE.md GEMINI.md README.md package.json tsconfig.json .prettierrc.json .ai .githooks)

echo "AI-Kit installer"
echo "  source: $SOURCE"
echo "  target: $TARGET"

if [[ -d "$TARGET/.ai" && "$FORCE" -ne 1 && "$DRY_RUN" -ne 1 ]]; then
  echo "An install already exists at $TARGET. Use --force to replace it." >&2
  exit 1
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "[dry-run] would copy: ${PAYLOAD[*]}"
  echo "[dry-run] would create home skeleton and CLI/worker/gate/plugin launchers"
  exit 0
fi

mkdir -p "$TARGET"

# Copy the payload, excluding disposable and per-platform trees.
tar -C "$SOURCE" \
  --exclude='node_modules' --exclude='.ai-work' --exclude='.git' \
  -cf - "${PAYLOAD[@]}" 2>/dev/null | tar -C "$TARGET" -xf -

# Create the flat home skeleton for user extensions (empty is fine).
for dir in plugins prompts workflows models templates config cache logs bin; do
  mkdir -p "$TARGET/$dir"
done

# --- Launchers: keep runtime files in the home and project state in the CWD. ---
write_launcher() {
  local launcher="$1"
  cat > "$launcher" <<'LAUNCH'
#!/usr/bin/env bash
set -euo pipefail
HOME_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="node"; command -v node >/dev/null 2>&1 || NODE_BIN="node.exe"
case "$(basename "$0")" in
  ai-kit) TARGET_SCRIPT="ai-kit.ts" ;;
  ai-kit-worker) TARGET_SCRIPT="worker-manager.ts" ;;
  ai-kit-gate) TARGET_SCRIPT="gate-runner.ts" ;;
  ai-kit-plugin) TARGET_SCRIPT="run-plugin.ts" ;;
  *) echo "unknown AI-Kit launcher: $0" >&2; exit 2 ;;
esac
export AIKIT_HOME="${AIKIT_HOME:-$HOME_DIR}"
export AIKIT_ROOT="${AIKIT_ROOT:-$HOME_DIR}"
export AIKIT_PROJECT_ROOT="${AIKIT_PROJECT_ROOT:-$PWD}"
export AIKIT_WORK="${AIKIT_WORK:-$PWD/.ai-work}"
exec "$NODE_BIN" \
  "$HOME_DIR/.ai/node/node_modules/tsx/dist/cli.mjs" \
  "$HOME_DIR/.ai/node/$TARGET_SCRIPT" "$@"
LAUNCH
  chmod +x "$launcher"
}
write_launcher "$TARGET/bin/ai-kit"
write_launcher "$TARGET/bin/ai-kit-worker"
write_launcher "$TARGET/bin/ai-kit-gate"
write_launcher "$TARGET/bin/ai-kit-plugin"

# --- Node runtime dependencies (esbuild binary is per-platform). ---
if [[ "$NO_DEPS" -ne 1 ]]; then
  echo "Installing Node runtime dependencies..."
  ( cd "$TARGET/.ai/node" && npm install --no-audit --no-fund >/dev/null 2>&1 ) \
    || { echo "npm install failed in $TARGET/.ai/node — rerun with network access, or use --no-deps and install manually." >&2; exit 1; }
fi

for launcher in ai-kit ai-kit-worker ai-kit-gate ai-kit-plugin; do
  [[ -x "$TARGET/bin/$launcher" ]] || { echo "installer verification failed: missing launcher $launcher" >&2; exit 1; }
done
if [[ -x "$TARGET/.ai/node/node_modules/tsx/dist/cli.mjs" ]]; then
  NODE_BIN="node"; command -v node >/dev/null 2>&1 || NODE_BIN="node.exe"
  "$NODE_BIN" "$TARGET/.ai/node/node_modules/tsx/dist/cli.mjs" "$TARGET/.ai/node/ai-kit.ts" version >/dev/null \
    || { echo "installer verification failed: installed CLI did not respond" >&2; exit 1; }
else
  echo "Warning: dependencies were skipped; run npm --prefix \"$TARGET/.ai/node\" install before using the CLI." >&2
fi

echo "AI-Kit installed into $TARGET"
echo "Add it to your PATH:"
echo "  export PATH=\"$TARGET/bin:\$PATH\""
echo "Then run:  ai-kit version"
