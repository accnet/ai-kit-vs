#!/usr/bin/env bash
# Canonical AI-Kit device installer.
# The shared runtime is installed into ~/ai-kit; use installer/install-project.sh
# when a project-local copy is explicitly required.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
exec bash "$ROOT/installer/install.sh" "$@"
