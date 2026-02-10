param(
  [string]$TargetProject = (Get-Location).Path,
  [string]$SynapseHome = ""
)

# Resolve Synapse home
if (-not $SynapseHome) {
  $SynapseHome = if ($env:SYNAPSE_HOME) { $env:SYNAPSE_HOME }
                 elseif (Test-Path (Join-Path $env:USERPROFILE '.synapse')) { Join-Path $env:USERPROFILE '.synapse' }
                 else { Resolve-Path (Join-Path $PSScriptRoot '..') }
}

$hookScript = Join-Path $SynapseHome 'hooks' 'send_event.cjs'
if (-not (Test-Path $hookScript)) {
  Write-Host "ERROR: Hook script not found at: $hookScript" -ForegroundColor Red
  Write-Host "Set -SynapseHome or SYNAPSE_HOME to the Synapse install directory."
  exit 1
}

# Normalize path for the hook command (forward slashes work everywhere)
$hookCmd = "node `"$($hookScript -replace '\\', '/')`""

$claudeDir = Join-Path $TargetProject '.claude'
$settingsFile = Join-Path $claudeDir 'settings.local.json'

# All Claude Code hook events
$hookEvents = @(
  'SessionStart', 'UserPromptSubmit',
  'SubagentStart', 'SubagentStop',
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'PreCompact',
  'Stop', 'SessionEnd'
)

# Async events (fire-and-forget, don't block Claude Code)
$asyncEvents = @(
  'PreToolUse', 'PostToolUse', 'PostToolUseFailure',
  'PermissionRequest', 'Notification', 'PreCompact'
)

# Build hooks object
$hooks = @{}
foreach ($event in $hookEvents) {
  $hookEntry = @{
    type = 'command'
    command = $hookCmd
  }
  if ($asyncEvents -contains $event) {
    $hookEntry.async = $true
  }
  $hooks[$event] = @(
    @{ hooks = @($hookEntry) }
  )
}

# Read existing settings or create new
$settings = @{}
if (Test-Path $settingsFile) {
  $existing = Get-Content $settingsFile -Raw | ConvertFrom-Json -AsHashtable -ErrorAction SilentlyContinue
  if ($existing) { $settings = $existing }
}

# Merge hooks (overwrite Synapse hooks, keep other hooks)
if (-not $settings.ContainsKey('hooks')) {
  $settings['hooks'] = @{}
}
foreach ($event in $hookEvents) {
  $settings['hooks'][$event] = $hooks[$event]
}

# Write
if (-not (Test-Path $claudeDir)) {
  New-Item -ItemType Directory -Force -Path $claudeDir | Out-Null
}
$settings | ConvertTo-Json -Depth 10 | Set-Content $settingsFile -Encoding UTF8

Write-Host "Synapse hooks configured in: $settingsFile" -ForegroundColor Green
Write-Host "Hook script: $hookScript"
Write-Host ""
Write-Host "Start Synapse with: synapse start"
