#!/usr/bin/env bash
# Repository-local Node control-plane entry point used by shell adapters.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
RUNTIME="$ROOT/.ai/node/node_modules"
NODE=(node)
RUNTIME_CLI="$RUNTIME/tsx/dist/cli.mjs"
SCRIPT="$ROOT/.ai/node/ai-kit.ts"
# A Windows checkout invoked from WSL has Windows esbuild binaries. Prefer the
# Windows Node executable there; normal Linux CI continues to use `node`.
if [[ "$(uname -s)" == "Linux" && "$ROOT" == /mnt/* ]] && command -v node.exe >/dev/null 2>&1; then
  NODE=(node.exe)
  RUNTIME_CLI="$(wslpath -w "$RUNTIME_CLI")"
  SCRIPT="$(wslpath -w "$SCRIPT")"
elif [[ "$(uname -s)" == "Linux" && -d "$RUNTIME/@esbuild/win32-x64" ]] && command -v node.exe >/dev/null 2>&1; then
  NODE=(node.exe)
fi
exec "${NODE[@]}" "$RUNTIME_CLI" "$SCRIPT" "$@"
