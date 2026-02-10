param()

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$extDir = Join-Path $root 'extension'
$resDir = Join-Path $extDir 'resources' 'synapse-server'

Write-Host ""
Write-Host "  Building Synapse VS Code Extension" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build frontend
Write-Host "[1/5] Building frontend..." -ForegroundColor Yellow
Push-Location $root
npm run build
Pop-Location

# Step 2: Copy server package into resources
Write-Host "[2/5] Bundling server into extension resources..." -ForegroundColor Yellow
if (Test-Path $resDir) { Remove-Item -Recurse -Force $resDir }
New-Item -ItemType Directory -Force -Path $resDir | Out-Null

$serverItems = @('dist', 'server', 'hooks', 'tsconfig.server.json', '.env.example')
foreach ($item in $serverItems) {
  $src = Join-Path $root $item
  if (Test-Path $src) {
    Copy-Item -Recurse -Force $src (Join-Path $resDir $item)
  }
}

# Create trimmed package.json for the bundled server
$pkgJson = @{
  name = 'synapse-server'
  version = '0.1.0'
  type = 'module'
  scripts = @{
    start = 'tsx server/index.ts'
  }
  dependencies = @{
    '@anthropic-ai/claude-agent-sdk' = 'latest'
    'better-sqlite3' = '^11.8.0'
    'express' = '^5.1.0'
    'express-rate-limit' = '^8.2.1'
    'nanoid' = '^5.1.0'
    'tsx' = '^4.19.0'
    'ws' = '^8.18.0'
  }
}
$pkgJson | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $resDir 'package.json') -Encoding UTF8

# Remove DB files from server copy
Get-ChildItem -Path (Join-Path $resDir 'server') -Recurse -Include '*.db', '*.db-wal', '*.db-shm' | Remove-Item -Force

# Step 3: Install server deps
Write-Host "[3/5] Installing server dependencies..." -ForegroundColor Yellow
Push-Location $resDir
npm install --production 2>&1 | Out-Null
Pop-Location

# Step 4: Build extension
Write-Host "[4/5] Building extension..." -ForegroundColor Yellow
Push-Location $extDir
npm install 2>&1 | Out-Null
npm run build
Pop-Location

# Step 5: Package .vsix
Write-Host "[5/5] Packaging .vsix..." -ForegroundColor Yellow
Push-Location $extDir
npx @vscode/vsce package --no-dependencies 2>&1
Pop-Location

$vsix = Get-ChildItem -Path $extDir -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($vsix) {
  # Copy to distribution/
  $distDir = Join-Path $root 'distribution'
  if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Force -Path $distDir | Out-Null }
  Copy-Item $vsix.FullName (Join-Path $distDir $vsix.Name) -Force
  Write-Host ""
  Write-Host "  Extension built: $($vsix.FullName)" -ForegroundColor Green
  Write-Host "  Install with: code --install-extension $($vsix.Name)" -ForegroundColor Cyan
  Write-Host ""
} else {
  Write-Host "  WARNING: .vsix file not found!" -ForegroundColor Red
}
