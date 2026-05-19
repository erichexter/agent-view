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
  [Nullable[int]]$TokensOut
)

$base = if ($env:AV_URL) { $env:AV_URL.TrimEnd('/') } else { 'http://localhost:4317' }

if (-not $Id) { Write-Error "-Id is required"; exit 2 }

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

try {
  Invoke-RestMethod -Uri "$base/api/events" -Method Post `
    -ContentType 'application/json' -Body ($body | ConvertTo-Json -Compress) | Out-Null
} catch {
  # Never let dashboard reporting break the agent.
  exit 0
}
