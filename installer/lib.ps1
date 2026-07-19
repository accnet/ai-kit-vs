<#
  Shared installer helpers, dot-sourced by both the project installer
  (install.ps1) and the global home installer (installer\install.ps1).
#>

# Throw unless a Node >= 22 runtime is on PATH.
function Assert-AiKitNode {
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js >=22 is required but was not found on PATH."
  }
  $major = [int]((& node -p "process.versions.node.split('.')[0]") 2>$null)
  if ($major -lt 22) { throw "AI-Kit requires Node.js >=22 (found $(& node -v))." }
}
