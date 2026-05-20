# PowerShell version of report.sh — same surface area.
# Usage:
#   .\report.ps1 register -Id alpha -Name "Alpha" -Tag "webapp:main"
#   .\report.ps1 start    -Id alpha -Task "Refactor auth"
#   .\report.ps1 done     -Id alpha -TokensIn 1200 -TokensOut 500 -Result ok
#   .\report.ps1 ask      -Id alpha -Prompt "OK to drop legacy index?"
#   .\report.ps1 log      -Id alpha -Message "tests passed"
#   .\report.ps1 resolved -Id alpha
#   .\report.ps1 bye      -Id alpha

param(
  [Parameter(Position=0, Mandatory=$true)][string]$Command,
  [string]$Id,
  [string]$Name,
  [string]$Tag,
  [string]$Task,
  [string]$Detail,
  [string]$Prompt,
  [string]$Url,
  [string]$Message,
  [string]$Level,
  [string]$Result,
  [string]$Summary,
  [string]$TaskId,
  [Nullable[int]]$TokensIn,
  [Nullable[int]]$TokensOut,
  [Nullable[int]]$StallAfterMs
)

$base = if ($env:AV_URL) { $env:AV_URL.TrimEnd('/') } else { 'http://192.168.1.68:4317' }

# Resolve agentId. Precedence: -Id flag > $env:AV_ID > per-project state file > auto-generate.
# IDs must be session/project-scoped, never shared at user level.
if (-not $Id) { $Id = $env:AV_ID }
if (-not $Id) {
  $projectDir = if ($env:CLAUDE_PROJECT_DIR) { $env:CLAUDE_PROJECT_DIR } else { (Get-Location).Path }
  $stateDir = Join-Path $projectDir '.claude'
  $stateFile = Join-Path $stateDir '.agent-view-id'
  if (Test-Path $stateFile) {
    $Id = (Get-Content $stateFile -Raw -ErrorAction SilentlyContinue).Trim()
  }
  if (-not $Id) {
    $baseName = (Split-Path $projectDir -Leaf) -replace '[^a-zA-Z0-9_-]', '-'
    if (-not $baseName) { $baseName = 'session' }
    $rand = -join ((48..57) + (97..102) | Get-Random -Count 8 | ForEach-Object { [char]$_ })
    $Id = "cc-$baseName-$rand"
    try {
      if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory -Path $stateDir -Force | Out-Null }
      Set-Content -Path $stateFile -Value $Id -Encoding ascii -NoNewline
    } catch { }
  }
}
if (-not $Id) { exit 0 }

$typeMap = @{
  'register' = 'register'; 'hello' = 'register';
  'heartbeat' = 'heartbeat';
  'start' = 'task_start'; 'update' = 'task_update'; 'done' = 'task_complete';
  'ask' = 'needs_input'; 'resolved' = 'input_resolved';
  'log' = 'log'; 'bye' = 'goodbye'
}
if (-not $typeMap.ContainsKey($Command)) {
  Write-Error "unknown command: $Command"; exit 2
}

$body = @{ agentId = $Id; type = $typeMap[$Command] }

# Fall back to AV_NAME / AV_TAG env vars when -Name / -Tag aren't passed.
# This lets a heartbeat hook refresh the friendly name on every tool call
# without re-issuing a register.
if (-not $Name -and $env:AV_NAME) { $Name = $env:AV_NAME }
if (-not $Tag  -and $env:AV_TAG)  { $Tag  = $env:AV_TAG }

if ($Name)      { $body.name      = $Name }
if ($Tag)       { $body.tag       = $Tag }
if ($Task)      { $body.title     = $Task }
if ($Detail)    { $body.detail    = $Detail }
if ($Prompt)    { $body.prompt    = $Prompt }
if ($Url)       { $body.url       = $Url }
if ($Message)   { $body.message   = $Message }
if ($Level)     { $body.level     = $Level }
if ($Result)    { $body.result    = $Result }
if ($Summary)   { $body.summary   = $Summary }
if ($TaskId)    { $body.taskId    = $TaskId }
if ($PSBoundParameters.ContainsKey('TokensIn'))  { $body.tokensIn  = $TokensIn }
if ($PSBoundParameters.ContainsKey('TokensOut')) { $body.tokensOut = $TokensOut }
if ($PSBoundParameters.ContainsKey('StallAfterMs')) { $body.stallAfterMs = $StallAfterMs }

try {
  Invoke-RestMethod -Uri "$base/api/events" -Method Post `
    -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) | Out-Null
} catch {
  # Never let dashboard reporting break the agent.
  exit 0
}
