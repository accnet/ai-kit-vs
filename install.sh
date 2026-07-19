#!/usr/bin/env bash
# Canonical AI-Kit device installer.
# The shared runtime is installed into ~/ai-kit; new projects use `ai-kit setup`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "$ROOT/installer/install.sh" "$@"
