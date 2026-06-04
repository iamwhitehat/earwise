#requires -Version 5.1
# Rebuild reddit-reader.exe from current source.
#
# What this does:
#   1. Builds the Next.js app with output: 'standalone' (-> .next/standalone/)
#   2. Copies public/, .next/static/, and .env.local into the standalone dir
#   3. Generates the Node SEA blob from scripts/sea-launcher.js
#   4. Kills any running reddit-reader.exe (avoids EBUSY)
#   5. Copies the system node.exe to reddit-reader.exe
#   6. Injects the SEA blob with postject
#
# After this runs, double-click reddit-reader.exe to launch the app.
# The .next/standalone/ directory must stay next to the exe.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "==> reddit-reader build:exe (root: $Root)" -ForegroundColor Cyan

# --- 1. Next.js build ---
Write-Host "==> [1/6] npm run build" -ForegroundColor Cyan
npm run build
if ($LASTEXITCODE -ne 0) { throw "next build failed" }

$Standalone = Join-Path $Root '.next\standalone'
if (-not (Test-Path $Standalone)) {
  throw "Expected .next/standalone after build; not found. Confirm next.config.ts sets output: 'standalone'."
}

# --- 2. Stage runtime files into standalone dir ---
Write-Host "==> [2/6] staging public/, .next/static/, .env.local into standalone" -ForegroundColor Cyan

if (Test-Path (Join-Path $Root 'public')) {
  $dstPublic = Join-Path $Standalone 'public'
  if (Test-Path $dstPublic) { Remove-Item -Recurse -Force $dstPublic }
  Copy-Item -Recurse -Force (Join-Path $Root 'public') $dstPublic
}

$staticSrc = Join-Path $Root '.next\static'
if (Test-Path $staticSrc) {
  $dstStatic = Join-Path $Standalone '.next\static'
  if (Test-Path $dstStatic) { Remove-Item -Recurse -Force $dstStatic }
  Copy-Item -Recurse -Force $staticSrc $dstStatic
}

$envSrc = Join-Path $Root '.env.local'
if (Test-Path $envSrc) {
  Copy-Item -Force $envSrc (Join-Path $Standalone '.env.local')
} else {
  Write-Warning ".env.local missing; the exe will start but Supabase/Anthropic calls will fail until you place it next to .next/standalone/server.js"
}

# --- 3. Generate SEA blob ---
Write-Host "==> [3/6] generating SEA blob" -ForegroundColor Cyan

$nodeCmd = Get-Command node -ErrorAction Stop
$NodeExe = $nodeCmd.Source
Write-Host "    node: $NodeExe"

$BlobPath = Join-Path $Root 'scripts\sea-blob.blob'
if (Test-Path $BlobPath) { Remove-Item -Force $BlobPath }

& $NodeExe --experimental-sea-config (Join-Path $Root 'scripts\sea-config.json')
if ($LASTEXITCODE -ne 0) { throw "sea-config generation failed" }
if (-not (Test-Path $BlobPath)) { throw "Expected $BlobPath after sea-config; not found" }

# --- 4. Kill any running exe so we can overwrite it ---
Write-Host "==> [4/6] killing any running reddit-reader.exe" -ForegroundColor Cyan
try { Stop-Process -Name reddit-reader -Force -ErrorAction Stop; Start-Sleep -Milliseconds 500 } catch {}

# --- 5. Copy node.exe -> reddit-reader.exe ---
Write-Host "==> [5/6] copying node.exe -> reddit-reader.exe" -ForegroundColor Cyan
$ExePath = Join-Path $Root 'reddit-reader.exe'
Copy-Item -Force $NodeExe $ExePath

# --- 6. Inject the SEA blob ---
Write-Host "==> [6/6] injecting SEA blob with postject" -ForegroundColor Cyan
npx --yes postject $ExePath NODE_SEA_BLOB $BlobPath --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2
if ($LASTEXITCODE -ne 0) { throw "postject injection failed" }

Write-Host ""
Write-Host "==> done." -ForegroundColor Green
Write-Host "Launch:  .\reddit-reader.exe"
Write-Host "Browse:  http://127.0.0.1:3000"
