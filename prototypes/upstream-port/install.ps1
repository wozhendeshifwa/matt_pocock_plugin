param(
  [switch]$Check
)

$ErrorActionPreference = "Stop"
$node = (Get-Command node -ErrorAction Stop).Source
$arguments = @((Join-Path $PSScriptRoot "install.mjs"))
if ($Check) {
  $arguments += "--check"
} else {
  $arguments += "--apply"
}
& $node @arguments
exit $LASTEXITCODE
