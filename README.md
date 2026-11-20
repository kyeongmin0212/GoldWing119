# G-J 골든타임 윙

전남·광주 광역 AI 에이전트 기반 긴급출동 선행 드론 관제 및 원클릭 불법주정차 신고 — 해커톤 시연용 대시보드.
지도·드론 영상·접수는 시뮬레이션이고, 차량번호·혼잡 DB·사고는 모두 가상입니다.

## 실행

```
npm install
npm run dev        # http://localhost:3000
npm run test:geo   # 투입 판단·회피 경로·선행 시간 검증
```

## 시연 흐름

1. 헤더에서 시나리오 선택: **광주 도심형**(출근길, 드론 1대) / **전남-광주 광역형**(퇴근길, 2대) / **평시 야간**(0대)
2. [출동 시나리오 시작] → 우측 **드론 투입 판단** 카드 → [드론 투입 승인]
3. 드론이 회피구역을 돌아 소방차보다 3~5분 먼저 혼잡 구간 도착, 도착 3분 전부터 길터주기 방송
4. 진로 방해 차량 탐지 → 신고서 초안(에이전트) → [원클릭 신고 승인] → 접수번호(MOCK)

## IBM watsonx Orchestrate 연동

- `.env.example` 을 `.env.local` 로 복사해 `WXO_ENDPOINT_URL`, `WXO_API_KEY`, `WXO_AGENT_NAME` 을 채우면 LIVE, 비우면 MOCK.
- 키는 서버 라우트(`src/app/api/agent/route.ts`)에서만 쓰며 브라우저로 보내지 않습니다. `NEXT_PUBLIC_` 을 붙이지 마세요.
- 에이전트 업로드: `orchestrate/upload.ps1 -Prefix <팀이니셜>` (README 상단 주석 참고). 업로드 후 `WXO_AGENT_NAME=<이니셜>_gjw_supervisor`.
- 로컬 도구 점검: `py -3.12 -I -X utf8 orchestrate/gjw_tools.py`
- 감독 에이전트는 Live 배포됨(`goldenwing_gjw_supervisor` live v1). **협업 에이전트·도구를 고친 뒤에는 다시 배포해야 Live 에 반영됩니다:** `orchestrate\.venv\Scripts\orchestrate.exe agents deploy --name goldenwing_gjw_supervisor`
- 시험 기록: `orchestrate/eval_results_run1.csv`(1차 7/8) → `eval_results_run3.csv`(8번 부분 실패) → `eval_results.csv`(최종 8/8)
- 감독 에이전트는 Live 배포됨(`goldenwing_gjw_supervisor` live v1). **협업 에이전트·도구를 고친 뒤에는 다시 배포해야 Live 에 반영됩니다:**
  `orchestrate\.venv\Scripts\orchestrate.exe agents deploy --name goldenwing_gjw_supervisor`
- 시험 기록: `orchestrate/eval_results_run1.csv`(1차 7/8) → `eval_results_run3.csv`(8번 부분 실패) → `eval_results.csv`(최종 8/8)

## 구조

| 경로 | 내용 |
|---|---|
| `src/lib/dispatch.ts` | 드론 투입 규칙 (지연 ≥3분 또는 혼잡 DB 지점 → 1~2대) |
| `src/lib/geo.ts` | 회피구역 A* 경로, 관제권 통과 판정, 관할 개략 매핑 |
| `src/lib/simulation.ts` | 소방차·드론 타임라인, 이륙 시각 조정(선행 4분), 탐지 시각 |
| `src/lib/wxo.ts`, `src/app/api/agent/route.ts` | Orchestrate REST 연동 + MOCK 전환 |
| `src/data/*` | 공역 DB(관제권 9.3km·회피구역), 혼잡 DB, 드론 거점(1단계 시범 6곳 × 3대 = 18대, 가상), 시나리오 |
| `orchestrate/` | 에이전트 YAML 5개, Python 도구 6개, 지식 1개, 업로드 스크립트, 시험 8문항 |

공식 출처는 `G-J_골든타임윙_참고자료_출처.md`(바탕 화면\IBM AI) 참고.
