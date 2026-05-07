param(
  [string]$ProjectName = "st-image2",
  [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = "D:\LLQ\codex\1"
Set-Location $ProjectRoot

Write-Host ""
Write-Host "Cloudflare Pages project: $ProjectName"
Write-Host "Static files: D:\LLQ\codex\1\public"
Write-Host "Functions: D:\LLQ\codex\1\functions"
Write-Host "Long job backend: https://st-image2-api.onrender.com"
Write-Host ""
Write-Host "If this is your first deploy, run this once first:"
Write-Host "  npx.cmd wrangler login"
Write-Host ""
Write-Host "Deploying to Cloudflare Pages..."
npx.cmd wrangler pages deploy public --project-name $ProjectName --branch $Branch
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "After deploy, bind the custom domain in Cloudflare Pages:"
Write-Host "  https://st.hbst.com"
Write-Host ""
Write-Host "Cloud URL: https://st.hbst.com"
Write-Host "Local debug URL: http://127.0.0.1:3000"
