# G-J 골든타임 윙 — Orchestrate 업로드 스크립트 (Windows PowerShell)
# 사용법:
#   1) 가상환경에서 ADK 설치:  py -3.12 -m venv .venv ; .\.venv\Scripts\Activate.ps1 ; pip install ibm-watsonx-orchestrate
#   2) 환경 연결(수업 0_setup 의 login.ps1 과 같음):
#        orchestrate env add -n edu_us_south -u <WXO_ENDPOINT_URL> --type ibm_iam
#        orchestrate env activate edu_us_south --api-key <WXO_API_KEY>
#   3) 팀 PM 이니셜로 실행:  .\upload.ps1 -Prefix kms
#      파일만 만들어 보기:     .\upload.ps1 -Prefix kms -DryRun
# 공유 계정 규칙: 이름은 이니셜_용도_agent/_tool/_kb, 남의 리소스는 건드리지 않는다.

param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[a-z][a-z0-9]{1,9}$')][string]$Prefix,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$src = $PSScriptRoot
$out = Join-Path $src "build_$Prefix"
New-Item -ItemType Directory -Force $out | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding $false

# gjw_ 접두사를 팀 이니셜로 바꿔 build 폴더에 복사
Get-ChildItem $src -File | Where-Object { $_.Name -like 'gjw_*' } | ForEach-Object {
  $text = [IO.File]::ReadAllText($_.FullName, $utf8)
  $text = $text -replace 'gjw_', "${Prefix}_gjw_"
  $name = $_.Name -replace '^gjw_', "${Prefix}_gjw_"
  [IO.File]::WriteAllText((Join-Path $out $name), $text, $utf8)
}
Write-Host "생성 완료: $out" -ForegroundColor Green
Get-ChildItem $out | ForEach-Object { Write-Host "  $($_.Name)" }

if ($DryRun) { Write-Host "DryRun — 업로드하지 않았습니다."; exit 0 }

if (-not (Get-Command orchestrate -ErrorAction SilentlyContinue)) {
  Write-Host "orchestrate CLI 가 없습니다. pip install ibm-watsonx-orchestrate 후 다시 실행하세요." -ForegroundColor Red
  exit 1
}

Push-Location $out
try {
  # 순서: 지식 → 도구 → 협업 에이전트 → 감독 에이전트
  orchestrate knowledge-bases import -f "${Prefix}_gjw_rules_kb.yaml"
  orchestrate tools import -k python -f "${Prefix}_gjw_tools.py"
  foreach ($a in 'route', 'pathfinder', 'vision', 'report') {
    orchestrate agents import -f "${Prefix}_gjw_${a}_agent.yaml"
  }
  orchestrate agents import -f "${Prefix}_gjw_supervisor.yaml"
  orchestrate knowledge-bases status --name "${Prefix}_gjw_rules_kb"
  Write-Host ""
  Write-Host "완료. 대시보드 .env.local 에 WXO_AGENT_NAME=${Prefix}_gjw_supervisor 를 넣으면 LIVE 모드가 됩니다." -ForegroundColor Green
}
finally {
  Pop-Location
}
