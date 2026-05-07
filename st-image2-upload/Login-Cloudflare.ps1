param()

$ErrorActionPreference = "Stop"
$ProjectRoot = "D:\LLQ\codex\1"
Set-Location $ProjectRoot

Write-Host ""
Write-Host "Cloudflare login for ST cloud deploy"
Write-Host "Project: $ProjectRoot"
Write-Host ""
Write-Host "A long login URL will appear below."
Write-Host "Copy the full URL into your browser, log in, and click Authorize."
Write-Host "Keep this PowerShell window open until Wrangler says login succeeded."
Write-Host ""

npx.cmd wrangler login --browser=false

Write-Host ""
Write-Host "Login command finished. You can close this window after checking the result above."
Read-Host "Press Enter to close"
