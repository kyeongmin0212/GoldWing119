# G-J 골든타임 윙

119 긴급출동 선행 드론 관제와 진로방해 차량 지자체 통보 — 해커톤 시연용.
지도·드론 영상·접수는 시뮬레이션이고, 차량번호·혼잡 DB·사고·거점은 모두 가상입니다.

## 화면 두 개

| 주소 | 쓰는 사람 | 하는 일 |
|---|---|---|
| `http://localhost:3000` 상황실 콘솔 | 119 종합상황실 관제요원 + 드론 원격 조종자 | 드론 투입 승인, 드론 영상 감독(수동 조종 전환), 진로방해 차량 통보 승인, 에이전트 기록·질의 |
| `http://localhost:3000/crew` 소방차 태블릿 | 출동 소방대원 | 드론 영상 공유받아 보기, 다음 혼잡 구간·길 확보 상태·진로방해 차량 (보기 전용) |

두 화면은 같은 브라우저 안에서 `BroadcastChannel` 로 실시간 공유합니다. 콘솔의 [소방차 화면 열기] 버튼으로 새 창을 띄우거나 두 창을 나란히 두고 시연하세요.

## 실행

```
npm install
npm run dev        # http://localhost:3000  (소방차 화면 /crew)
npm run test:geo   # 투입 판단·회피 경로·선행 시간·시범 18대 검증
```

## 시연 흐름

1. 시나리오 선택: **도심 · 출근시간**(드론 1대) / **광역 · 퇴근시간**(2대) / **야간 · 한산**(0대, 투입 불필요)
2. [출동 시나리오 시작] → 사건 처리 탭 **드론 투입 판단** → [드론 투입 승인]
3. 드론이 회피구역을 돌아 소방차보다 약 4분 먼저 혼잡 구간 도착, 소방차 도착 3분 전부터 길터주기 방송 — 소방차 화면에도 같이 표시
4. 진로방해 차량 탐지 → 통보 초안(에이전트, 근거 문서 표시) → [통보 승인] → 접수번호(MOCK)
5. 질의 탭: "견인 지원 요청 근거는?" 등 → 지식 문서를 근거로 답하고 근거 문서 이름 표시

## IBM watsonx Orchestrate 연동

- `.env.example` 을 `.env.local` 로 복사해 `WXO_ENDPOINT_URL`, `WXO_API_KEY`, `WXO_AGENT_NAME` 을 채우면 LIVE, 비우면 MOCK.
- 키는 서버 라우트(`src/app/api/agent/route.ts`)에서만 쓰며 브라우저로 보내지 않습니다. `NEXT_PUBLIC_` 을 붙이지 마세요.
- 처음 연결·업로드: `orchestrate/live_setup.ps1 -Prefix <팀이니셜>` (팀 접두사 `goldenwing` 으로 업로드됨).
- CLI 로그인 토큰은 약 1시간 — 만료되면 `orchestrate env activate gjw_edu --api-key <키>` 후 다시 실행.
- 감독 에이전트는 Live 배포됨. **지식·도구·협업 에이전트를 고친 뒤에는 다시 배포해야 Live 에 반영됩니다:**
  `orchestrate\.venv\Scripts\orchestrate.exe agents deploy --name goldenwing_gjw_supervisor`
- 로컬 도구 점검: `py -3.12 -I -X utf8 orchestrate/gjw_tools.py` / LIVE 시험: `orchestrate\.venv\Scripts\python.exe -I -X utf8 orchestrate/eval_live.py`

## 지식(RAG) 문서 4개 — `gjw_rules_kb`

Orchestrate 가 문서를 나눠 임베딩해 벡터 색인에 넣고, 질문과 가까운 문단을 찾아 근거로 답합니다.

| 파일 | 내용 |
|---|---|
| `orchestrate/gjw_law_text.txt` | 관련 법령 조문 원문 발췌 (국가법령정보센터 현행본, 2026-11-20 열람) |
| `orchestrate/gjw_rules_doc.txt` | 단속 규정 요약 |
| `orchestrate/gjw_drone_sop.txt` | 드론 선행 출동 운용 절차서 (가상) |
| `orchestrate/gjw_report_form.txt` | 지자체 통보 양식과 작성 요령 (가상) |

시험 기록: `orchestrate/eval_results_run*.csv` → 최종 `eval_results.csv` (10문항 10/10, 실패·수정 이력 포함).

## 구조

| 경로 | 내용 |
|---|---|
| `src/app/page.tsx`, `src/app/crew/page.tsx` | 상황실 콘솔, 소방차 태블릿 |
| `src/lib/useGoldenTimeSim.ts` | 콘솔 상태·이벤트·에이전트 호출, 소방차 화면으로 상태 공유 |
| `src/lib/simBridge.ts`, `src/lib/simView.ts` | 화면 간 공유 채널, 두 화면 공용 상태 타입 |
| `src/lib/dispatch.ts` | 드론 투입 규칙 (지연 ≥3분 또는 혼잡 DB 지점 → 1~2대) |
| `src/lib/geo.ts` | 회피구역 A* 경로, 관제권 통과 판정, 관할 매핑(전남광주통합특별시 표기) |
| `src/lib/simulation.ts` | 소방차·드론 타임라인, 이륙 시각 조정(선행 4분), 탐지 시각 |
| `src/lib/wxo.ts`, `src/app/api/agent/route.ts` | Orchestrate REST 연동, 근거 문서 추출, MOCK 전환 |
| `src/data/*` | 공역 DB(관제권 9.3km·회피구역), 혼잡 DB, 드론 거점(시범 6곳 × 3대 = 18대), 시나리오 |
| `orchestrate/` | 에이전트 YAML 5개, Python 도구 6개, 지식 문서 4개, 업로드·LIVE 설정·시험 스크립트 |

공식 출처는 `G-J_골든타임윙_참고자료_출처.md`(바탕 화면\IBM AI) 참고.
