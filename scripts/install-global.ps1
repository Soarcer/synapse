param(
  [string]$InstallDir = (Join-Path $env:USERPROFILE '.synapse')
)

$scriptDir = $PSScriptRoot
$root = Resolve-Path (Join-Path $scriptDir '..')

Write-Host ""
Write-Host "  Synapse Installer" -ForegroundColor Cyan
Write-Host "  Installing to: $InstallDir"
Write-Host ""

# Step 1: Build prebuilt package
Write-Host "[1/4] Building package..." -ForegroundColor Yellow
$tempPkg = Join-Path $env:TEMP 'synapse-pkg'
& (Join-Path $scriptDir 'make-package.ps1') -OutDir $tempPkg -Prebuilt

$pkgSource = Join-Path $tempPkg 'Synapse'

# Step 2: Copy to install dir
Write-Host "[2/4] Copying to $InstallDir..." -ForegroundColor Yellow
if (Test-Path $InstallDir) {
  # Preserve .env and DB
  $preserveFiles = @()
  $envFile = Join-Path $InstallDir '.env'
  $envBackup = Join-Path $env:TEMP 'synapse-env-backup'
  if (Test-Path $envFile) {
    Copy-Item $envFile $envBackup -Force
    $preserveFiles += $envBackup
  }

  Remove-Item -Recurse -Force $InstallDir
}
Copy-Item -Recurse -Force $pkgSource $InstallDir

# Restore preserved files
if (Test-Path (Join-Path $env:TEMP 'synapse-env-backup')) {
  Copy-Item (Join-Path $env:TEMP 'synapse-env-backup') (Join-Path $InstallDir '.env') -Force
  Remove-Item (Join-Path $env:TEMP 'synapse-env-backup') -Force
}

# Step 3: Install dependencies
Write-Host "[3/4] Installing dependencies..." -ForegroundColor Yellow
Push-Location $InstallDir
npm install --production 2>&1 | Out-Null
Pop-Location

# Create .env from example if it doesn't exist
$envFile = Join-Path $InstallDir '.env'
if (-not (Test-Path $envFile)) {
  $envExample = Join-Path $InstallDir '.env.example'
  if (Test-Path $envExample) {
    Copy-Item $envExample $envFile
  }
}

# Step 4: Create CLI shim
Write-Host "[4/4] Creating CLI shim..." -ForegroundColor Yellow

# Copy synapse.ps1 into the install dir
Copy-Item (Join-Path $scriptDir 'synapse.ps1') (Join-Path $InstallDir 'synapse.ps1') -Force
Copy-Item (Join-Path $scriptDir 'synapse.sh') (Join-Path $InstallDir 'synapse.sh') -Force

# Create a batch file shim for easy PATH usage
$batShim = Join-Path $InstallDir 'synapse.cmd'
@"
@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0synapse.ps1" %*
"@ | Set-Content $batShim -Encoding ASCII

# Add to PATH if not already there
$currentPath = [Environment]::GetEnvironmentVariable('PATH', 'User')
if ($currentPath -notlike "*$InstallDir*") {
  [Environment]::SetEnvironmentVariable('PATH', "$InstallDir;$currentPath", 'User')
  Write-Host "  Added $InstallDir to user PATH" -ForegroundColor Gray
}

# Clean up
Remove-Item -Recurse -Force $tempPkg -ErrorAction SilentlyContinue

Write-Host ""
Write-Host "  Synapse installed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "  Usage:" -ForegroundColor Cyan
Write-Host "    synapse start           Start the dashboard server"
Write-Host "    synapse hook <project>  Configure hooks for a project"
Write-Host "    synapse open            Open dashboard in browser"
Write-Host "    synapse help            Show all commands"
Write-Host ""
Write-Host "  NOTE: Restart your terminal for PATH changes to take effect."
Write-Host ""
