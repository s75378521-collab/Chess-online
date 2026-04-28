$shareLinkFile = Join-Path $PSScriptRoot "share-link.txt"

if (Test-Path $shareLinkFile) {
    Write-Host "CURRENT SHARE LINK:"
    Get-Content $shareLinkFile | Select-Object -First 1
    exit 0
}

Write-Host "No current share link was found."
Write-Host "Run start-share.cmd first."
exit 1
