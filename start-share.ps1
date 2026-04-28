$projectRoot = $PSScriptRoot
$nodePath = "C:\Users\Spencer Ramsay.SPENCER-RAMSAY\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$toolsDir = Join-Path $projectRoot "tools"
$cloudflaredPath = Join-Path $toolsDir "cloudflared.exe"
$cloudflaredUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
$serverLog = Join-Path $projectRoot "server-public.log"
$serverErrLog = Join-Path $projectRoot "server-public-error.log"
$tunnelLog = Join-Path $projectRoot "cloudflared.log"
$shareLinkFile = Join-Path $projectRoot "share-link.txt"

function Test-ServerReady {
    try {
        Invoke-WebRequest "http://127.0.0.1:3000/" -UseBasicParsing | Out-Null
        return $true
    } catch {
        return $false
    }
}

if (!(Test-Path $nodePath)) {
    Write-Error "Bundled Node runtime was not found."
    exit 1
}

New-Item -ItemType Directory -Force -Path $toolsDir | Out-Null

if (!(Test-Path $cloudflaredPath)) {
    Write-Host "Downloading Cloudflare tunnel tool..."
    Invoke-WebRequest -Uri $cloudflaredUrl -OutFile $cloudflaredPath
}

if (-not (Test-ServerReady)) {
    Write-Host "Starting Chessplay server in the background..."
    Start-Process -FilePath $nodePath -ArgumentList ".\server.js" -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput $serverLog -RedirectStandardError $serverErrLog | Out-Null

    $serverReady = $false
    for ($i = 0; $i -lt 15; $i += 1) {
        Start-Sleep -Seconds 1
        if (Test-ServerReady) {
            $serverReady = $true
            break
        }
    }

    if (-not $serverReady) {
        Write-Error "Chessplay server is not responding on http://localhost:3000"
        exit 1
    }
}

$existingUrl = $null
if (Test-Path $shareLinkFile) {
    $existingUrl = (Get-Content $shareLinkFile -ErrorAction SilentlyContinue | Select-Object -First 1).Trim()
}

$cloudflaredRunning = Get-Process cloudflared -ErrorAction SilentlyContinue
if ($cloudflaredRunning -and $existingUrl) {
    Write-Host ""
    Write-Host "Sharing is already running."
    Write-Host "SHARE THIS LINK:"
    Write-Host $existingUrl
    Write-Host ""
    Write-Host "Link saved in share-link.txt"
    exit 0
}

Get-Process cloudflared -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 500

if (Test-Path $tunnelLog) {
    Remove-Item -LiteralPath $tunnelLog -Force
}
if (Test-Path $shareLinkFile) {
    Remove-Item -LiteralPath $shareLinkFile -Force
}

Write-Host "Starting public share link in the background..."

$quotedTunnelLog = '"' + $tunnelLog + '"'
$argumentList = "tunnel --url http://localhost:3000 --logfile $quotedTunnelLog"
$tunnelProcess = Start-Process -FilePath $cloudflaredPath -ArgumentList $argumentList -WorkingDirectory $projectRoot -PassThru -WindowStyle Hidden

$shareUrl = $null
for ($i = 0; $i -lt 30; $i += 1) {
    Start-Sleep -Seconds 1
    if (Test-Path $tunnelLog) {
        $match = Select-String -Path $tunnelLog -Pattern "https://[-a-z0-9]+\.trycloudflare\.com" -AllMatches -ErrorAction SilentlyContinue | Select-Object -Last 1
        if ($match) {
            $shareUrl = $match.Matches[-1].Value
            break
        }
    }

    if ($tunnelProcess.HasExited) {
        break
    }
}

if (-not $shareUrl) {
    Write-Error "Couldn't get the share link. Check cloudflared.log and try again."
    exit 1
}

Set-Content -LiteralPath $shareLinkFile -Value $shareUrl

Write-Host ""
Write-Host "SHARE THIS LINK:"
Write-Host $shareUrl
Write-Host ""
Write-Host "This link is also saved in share-link.txt"
Write-Host "Run stop-share.cmd when you want to turn it off."
