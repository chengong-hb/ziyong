param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "D:\LLQ\codex\1"
$ToolsDir = Join-Path $ProjectRoot "tools"
$Cloudflared = "D:\LLQ\codex\1\tools\cloudflared.exe"
$CloudflaredUrls = @(
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
  "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-386.exe"
)

New-Item -ItemType Directory -Force -Path $ToolsDir | Out-Null

function Test-Cloudflared {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return $false }
  try {
    & $Path --version | Out-Null
    return $true
  } catch {
    return $false
  }
}

if (-not (Test-Cloudflared -Path $Cloudflared)) {
  if (Test-Path -LiteralPath $Cloudflared) {
    Remove-Item -LiteralPath $Cloudflared -Force
  }

  $downloaded = $false
  foreach ($CloudflaredUrl in $CloudflaredUrls) {
    Write-Host "Downloading cloudflared to D drive..."
    Invoke-WebRequest -UseBasicParsing -Uri $CloudflaredUrl -OutFile $Cloudflared
    if (Test-Cloudflared -Path $Cloudflared) {
      $downloaded = $true
      break
    }
    Remove-Item -LiteralPath $Cloudflared -Force -ErrorAction SilentlyContinue
  }

  if (-not $downloaded) {
    throw "cloudflared download finished, but the executable cannot run on this Windows system."
  }
}

$env:PORT = [string]$Port
$env:HOST = "0.0.0.0"

$existing = Get-NetTCPConnection -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pidValue in $existing) {
  if ($pidValue) { Stop-Process -Id $pidValue -Force -ErrorAction SilentlyContinue }
}

$app = Start-Process -FilePath "node" -ArgumentList @("server.js") -WorkingDirectory $ProjectRoot -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 2
$LocalUrl = "http://127.0.0.1:{0}" -f $Port

Write-Host ""
Write-Host "Local site: $LocalUrl"
Write-Host "Starting Cloudflare Tunnel. Send the trycloudflare.com link to your family."
Write-Host "Everyone enters their own API Key in the website."
Write-Host ""

try {
  & $Cloudflared tunnel --url $LocalUrl
} finally {
  if (-not $app.HasExited) {
    Stop-Process -Id $app.Id -Force -ErrorAction SilentlyContinue
  }
}
