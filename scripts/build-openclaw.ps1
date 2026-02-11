param()

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$pluginDir = Join-Path $root 'openclaw-plugin'
$outDir = Join-Path $root 'distribution' 'synapse-openclaw'

Write-Host ""
Write-Host "  Building Synapse OpenClaw Plugin" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build frontend (dashboard)
Write-Host "[1/5] Building frontend..." -ForegroundColor Yellow
Push-Location $root
npm run build
Pop-Location

# Step 2: Bundle plugin via esbuild
Write-Host "[2/5] Building plugin bundle..." -ForegroundColor Yellow
Push-Location $pluginDir
if (-not (Test-Path (Join-Path $pluginDir 'node_modules'))) {
  npm install 2>&1 | Out-Null
}
node esbuild.mjs
Pop-Location

# Step 3: Assemble output directory
Write-Host "[3/5] Assembling distribution package..." -ForegroundColor Yellow
if (Test-Path $outDir) { Remove-Item -Recurse -Force $outDir }
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# Copy dashboard assets
$items = @('dist', 'server', 'hooks', 'tsconfig.server.json', '.env.example')
foreach ($item in $items) {
  $src = Join-Path $root $item
  if (Test-Path $src) {
    Copy-Item -Recurse -Force $src (Join-Path $outDir $item)
  }
}

# Copy plugin bundle + manifest
$pluginOutDir = Join-Path $outDir 'openclaw-plugin'
New-Item -ItemType Directory -Force -Path $pluginOutDir | Out-Null
Copy-Item -Recurse -Force (Join-Path $pluginDir 'dist') (Join-Path $pluginOutDir 'dist')
Copy-Item -Force (Join-Path $pluginDir 'package.json') (Join-Path $pluginOutDir 'package.json')

# Remove DB files from server copy
Get-ChildItem -Path (Join-Path $outDir 'server') -Recurse -Include '*.db', '*.db-wal', '*.db-shm' | Remove-Item -Force

# Create trimmed server package.json
$pkgJson = @{
  name = 'synapse-server'
  version = '0.1.0'
  type = 'module'
  scripts = @{
    start = 'tsx server/index.ts'
  }
  dependencies = @{
    'better-sqlite3' = '^11.8.0'
    'express' = '^5.1.0'
    'express-rate-limit' = '^8.2.1'
    'nanoid' = '^5.1.0'
    'tsx' = '^4.19.0'
    'ws' = '^8.18.0'
  }
}
$pkgJson | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $outDir 'package.json') -Encoding UTF8

# Step 4: Install runtime dependencies
Write-Host "[4/5] Installing runtime dependencies..." -ForegroundColor Yellow
Push-Location $outDir
npm install --production 2>&1 | Out-Null
Pop-Location

Push-Location $pluginOutDir
npm install --production 2>&1 | Out-Null
Pop-Location

# Step 5: Summary
$totalSize = (Get-ChildItem -Path $outDir -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host ""
Write-Host "[5/5] Done!" -ForegroundColor Green
Write-Host ""
Write-Host "  Output: $outDir" -ForegroundColor Cyan
Write-Host "  Size:   $([math]::Round($totalSize, 1)) MB" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Install:" -ForegroundColor Yellow
Write-Host "    cp -r $outDir ~/.openclaw/extensions/synapse-monitor"
Write-Host ""
Write-Host "  Then add to ~/.openclaw/openclaw.json:" -ForegroundColor Yellow
Write-Host '    "plugins": { "synapse-monitor": { "port": 4000 } }'
Write-Host ""
