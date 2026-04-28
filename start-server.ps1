$bundledNode = "C:\Users\Spencer Ramsay.SPENCER-RAMSAY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$serverPath = Join-Path $PSScriptRoot "server.js"

if (Test-Path $bundledNode) {
    & $bundledNode $serverPath
    exit $LASTEXITCODE
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
    & $nodeCommand.Source $serverPath
    exit $LASTEXITCODE
}

Write-Error "Node.js was not found. Install Node or restore the bundled Codex runtime, then run this script again."
exit 1
