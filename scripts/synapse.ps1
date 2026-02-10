param(
  [Parameter(Position=0)]
  [string]$Command = 'help',
  [Parameter(Position=1, ValueFromRemainingArguments)]
  [string[]]$Args
)

$SynapseHome = if ($env:SYNAPSE_HOME) { $env:SYNAPSE_HOME } else { Join-Path $env:USERPROFILE '.synapse' }
$PidFile = Join-Path $SynapseHome 'synapse.pid'

function Load-Env {
  $envFile = Join-Path $SynapseHome '.env'
  if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
      $line = $_.Trim()
      if (-not $line -or $line.StartsWith('#')) { return }
      $parts = $line.Split('=', 2)
      if ($parts.Count -eq 2) {
        Set-Item -Path "Env:$($parts[0].Trim())" -Value $parts[1].Trim()
      }
    }
  }
}

function Start-Synapse {
  $background = $Args -contains '--background' -or $Args -contains '-b'

  if (-not (Test-Path $SynapseHome)) {
    Write-Host "Synapse not installed at $SynapseHome" -ForegroundColor Red
    Write-Host "Run: .\scripts\install-global.ps1"
    return
  }

  Load-Env

  if ($background) {
    $proc = Start-Process -FilePath 'npx' -ArgumentList 'tsx', 'server/index.ts' `
      -WorkingDirectory $SynapseHome -NoNewWindow -PassThru -RedirectStandardOutput (Join-Path $SynapseHome 'synapse.log')
    $proc.Id | Set-Content $PidFile
    Write-Host "Synapse started in background (PID: $($proc.Id))" -ForegroundColor Green
    $port = if ($env:PORT) { $env:PORT } else { '4000' }
    Write-Host "Dashboard: http://localhost:$port"
  } else {
    Push-Location $SynapseHome
    npx tsx server/index.ts
    Pop-Location
  }
}

function Stop-Synapse {
  if (Test-Path $PidFile) {
    $pid = Get-Content $PidFile
    try {
      Stop-Process -Id $pid -Force -ErrorAction Stop
      Write-Host "Synapse stopped (PID: $pid)" -ForegroundColor Yellow
    } catch {
      Write-Host "Process $pid not found (already stopped?)" -ForegroundColor Gray
    }
    Remove-Item $PidFile -Force
  } else {
    Write-Host "No PID file found. Synapse may not be running in background mode." -ForegroundColor Gray
  }
}

function Get-Status {
  $port = if ($env:PORT) { $env:PORT } else { '4000' }
  try {
    $resp = Invoke-WebRequest -Uri "http://localhost:$port/api/health" -TimeoutSec 2 -ErrorAction Stop
    $data = $resp.Content | ConvertFrom-Json
    Write-Host "Synapse is RUNNING on port $port" -ForegroundColor Green
    Write-Host "  Connected clients: $($data.clients)"
    Write-Host "  Dashboard: http://localhost:$port"
  } catch {
    Write-Host "Synapse is NOT RUNNING on port $port" -ForegroundColor Red
  }
}

function Setup-Hook {
  $target = if ($Args.Count -gt 0 -and $Args[0] -ne '--background' -and $Args[0] -ne '-b') { $Args[0] } else { (Get-Location).Path }
  & (Join-Path $SynapseHome 'scripts' 'setup-hooks.ps1') -TargetProject $target -SynapseHome $SynapseHome
}

function Remove-Hook {
  $target = if ($Args.Count -gt 0) { $Args[0] } else { (Get-Location).Path }
  $settingsFile = Join-Path $target '.claude' 'settings.local.json'
  if (Test-Path $settingsFile) {
    Remove-Item $settingsFile -Force
    Write-Host "Removed Synapse hooks from: $settingsFile" -ForegroundColor Yellow
  } else {
    Write-Host "No .claude/settings.local.json found in: $target" -ForegroundColor Gray
  }
}

function Open-Dashboard {
  Load-Env
  $port = if ($env:PORT) { $env:PORT } else { '4000' }
  Start-Process "http://localhost:$port"
}

function Show-Help {
  Write-Host ""
  Write-Host "  Synapse - Claude Agent Monitor" -ForegroundColor Cyan
  Write-Host ""
  Write-Host "  Usage: synapse <command> [options]"
  Write-Host ""
  Write-Host "  Commands:"
  Write-Host "    start [--background]  Start the Synapse server"
  Write-Host "    stop                  Stop a background Synapse server"
  Write-Host "    status                Check if Synapse is running"
  Write-Host "    hook [path]           Configure hooks for a project (default: cwd)"
  Write-Host "    unhook [path]         Remove hooks from a project (default: cwd)"
  Write-Host "    open                  Open dashboard in browser"
  Write-Host "    help                  Show this help"
  Write-Host ""
  Write-Host "  Home: $SynapseHome"
  Write-Host ""
}

switch ($Command) {
  'start'   { Start-Synapse }
  'stop'    { Stop-Synapse }
  'status'  { Get-Status }
  'hook'    { Setup-Hook }
  'unhook'  { Remove-Hook }
  'open'    { Open-Dashboard }
  'help'    { Show-Help }
  default   { Show-Help }
}
