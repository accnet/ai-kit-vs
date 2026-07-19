<#
  Canonical AI-Kit device installer.
  The shared runtime is installed into %USERPROFILE%\ai-kit.
  New projects use the installed `ai-kit setup` command.
#>
$installer = Join-Path $PSScriptRoot "installer\install.ps1"
& $installer @args
exit $LASTEXITCODE
