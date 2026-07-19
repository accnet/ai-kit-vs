<#
  Canonical AI-Kit device installer.
  The shared runtime is installed into %USERPROFILE%\ai-kit.
  Use installer\install-project.ps1 for an explicit project-local copy.
#>
$installer = Join-Path $PSScriptRoot "installer\install.ps1"
& $installer @args
exit $LASTEXITCODE
