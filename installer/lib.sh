#!/usr/bin/env bash
# Shared installer helpers, sourced by both the project installer (install.sh)
# and the global home installer (installer/install.sh). Keep this dependency-free.

# Resolve a Node >= 22 binary or fail. Prints the binary name on success.
# Usage: NODE_BIN="$(aikit_require_node)" || exit 1
aikit_require_node() {
  local bin=""
  if command -v node >/dev/null 2>&1; then bin=node
  elif command -v node.exe >/dev/null 2>&1; then bin=node.exe
  fi
  [[ -n "$bin" ]] || { echo "Node.js >=22 is required but was not found on PATH." >&2; return 1; }
  local major
  major="$("$bin" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
  [[ "$major" -ge 22 ]] || { echo "AI-Kit requires Node.js >=22 (found $("$bin" -v 2>/dev/null))." >&2; return 1; }
  printf '%s' "$bin"
}
