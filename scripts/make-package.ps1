param(
  [string]$OutDir = "$(Join-Path $PSScriptRoot '..\_package')",
  [switch]$Prebuilt
)

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$pkgRoot = Join-Path $OutDir 'Synapse'

if (Test-Path $pkgRoot) {
  Remove-Item -Recurse -Force $pkgRoot
}
New-Item -ItemType Directory -Force -Path $pkgRoot | Out-Null

# Build frontend if prebuilt mode
if ($Prebuilt) {
  Write-Host "Building frontend..."
  Push-Location $root
  npm run build
  Pop-Location
}

# Common items (both modes)
$common = @(
  'package.json',
  'tsconfig.server.json',
  'hooks',
  '.claude',
  'start-server.ps1',
  'start-server.sh',
  '.env.example',
  '.nvmrc',
  'docs/DEPLOYMENT.md',
  'docs/PACKAGE.md'
)

# Source-run extras
$sourceOnly = @(
  'vite.config.ts',
  'tsconfig.json',
  'index.html',
  'src',
  'start-client.ps1',
  'start-client.sh'
)

# Prebuilt extras
$prebuiltOnly = @(
  'dist'
)

$items = $common
if ($Prebuilt) {
  $items += $prebuiltOnly
} else {
  $items += $sourceOnly
}

# Always include scripts dir (simulation, setup)
$items += 'scripts/simulate_session.ts'

foreach ($item in $items) {
  $src = Join-Path $root $item
  if (Test-Path $src) {
    $dest = Join-Path $pkgRoot $item
    $destDir = Split-Path $dest -Parent
    if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
    Copy-Item -Recurse -Force $src $dest
  }
}

# Copy server/ but exclude DB files
$serverSrc = Join-Path $root 'server'
$serverDest = Join-Path $pkgRoot 'server'
New-Item -ItemType Directory -Force -Path $serverDest | Out-Null
Get-ChildItem -Path $serverSrc -Recurse | Where-Object {
  $_.Name -notmatch '\.db$|\.db-wal$|\.db-shm$'
} | ForEach-Object {
  $relPath = $_.FullName.Substring($serverSrc.Length)
  $destPath = Join-Path $serverDest $relPath
  if ($_.PSIsContainer) {
    New-Item -ItemType Directory -Force -Path $destPath | Out-Null
  } else {
    $destDir2 = Split-Path $destPath -Parent
    if (-not (Test-Path $destDir2)) { New-Item -ItemType Directory -Force -Path $destDir2 | Out-Null }
    Copy-Item -Force $_.FullName $destPath
  }
}

# Remove any accidentally copied node_modules or debug logs
$junk = @(
  (Join-Path $pkgRoot 'node_modules'),
  (Join-Path $pkgRoot 'hook_debug.log')
)
foreach ($j in $junk) {
  if (Test-Path $j) { Remove-Item -Recurse -Force $j }
}

Write-Host "Package created at: $pkgRoot"

# Zip to distribution/
$distDir = Join-Path $root 'distribution'
if (-not (Test-Path $distDir)) { New-Item -ItemType Directory -Force -Path $distDir | Out-Null }
$zipPath = Join-Path $distDir 'Synapse.zip'
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
Compress-Archive -Path $pkgRoot -DestinationPath $zipPath
Write-Host "Zip created at: $zipPath"
