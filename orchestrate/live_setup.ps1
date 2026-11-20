# G-J 골든타임 윙 — LIVE 연동 한 번에 하기 (키는 화면에 출력하지 않음)
# 준비: C:\edu\gj-wing\.env.local 에 WXO_ENDPOINT_URL, WXO_API_KEY 입력
# 실행: powershell -ExecutionPolicy Bypass -File .\live_setup.ps1 -Prefix <팀이니셜>
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9]{1,9}$')][string]$Prefix
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$envFile = Join-Path $root '.env.local'
$orc = Join-Path $PSScriptRoot '.venv\Scripts\orchestrate.exe'
if (-not (Test-Path $orc)) { throw "ADK 가 없습니다: py -3.12 -m venv .venv ; .venv\Scripts\pip install ibm-watsonx-orchestrate==2.20.0" }
if (-not (Test-Path $envFile)) { throw ".env.local 이 없습니다." }

$cfg = @{}
foreach ($line in [IO.File]::ReadAllLines($envFile)) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
}
if (-not $cfg['WXO_ENDPOINT_URL'] -or -not $cfg['WXO_API_KEY']) { throw ".env.local 에 WXO_ENDPOINT_URL 과 WXO_API_KEY 를 채워 주세요." }

Write-Host "1/3 Orchestrate 환경 연결 (us-south)..." -ForegroundColor Cyan
& $orc env add -n gjw_edu -u $cfg['WXO_ENDPOINT_URL'] --type ibm_iam 2>$null | Out-Null
& $orc env activate gjw_edu --api-key $cfg['WXO_API_KEY'] | Out-Null
if ($LASTEXITCODE -ne 0) { throw "환경 연결 실패 — URL·키를 확인하세요 (값은 출력하지 않음)." }

Write-Host "2/3 지식·도구·에이전트 업로드..." -ForegroundColor Cyan
$env:PATH = (Join-Path $PSScriptRoot '.venv\Scripts') + ';' + $env:PATH
& (Join-Path $PSScriptRoot 'upload.ps1') -Prefix $Prefix

Write-Host "3/3 .env.local 에 감독 에이전트 이름 기록..." -ForegroundColor Cyan
$text = [IO.File]::ReadAllText($envFile)
$text = [Text.RegularExpressions.Regex]::Replace($text, '(?m)^WXO_AGENT_NAME=.*$', "WXO_AGENT_NAME=${Prefix}_gjw_supervisor")
[IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
Write-Host "완료. 다음: .venv\Scripts\python.exe -I -X utf8 eval_live.py  (8문항 시험)" -ForegroundColor Green
