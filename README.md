# 골든윙 119 (Golden Wing 119)

119 소방차 앞길 정찰 드론 관제와 진로방해 차량 지자체 통보 초안 — 해커톤 시연용.
지도·드론 영상·도로 공사는 시뮬레이션이고, 차량번호·혼잡 DB·도로 공사·거점은 모두 가상입니다.
**비행 제한 구역(관제권·회피구역)은 이번 시연에서 드론 경로에 반영하지 않았습니다 — 추후 보완.** 대신 시나리오 장소는 광주공항 관제권(반경 9.3km) 밖에 두었습니다. 드론 거점은 소방서 6곳(가상 위치)에 두어 드론이 소방차와 같은 소방서에서 출발합니다.

## 화면 두 개

| 주소 | 쓰는 사람 | 하는 일 |
|---|---|---|
| `http://localhost:3000` 상황실 콘솔 | 119 종합상황실 관제요원 + 드론 원격 조종자 | 드론 투입 승인, 드론 조종(원격 조종자 — 시스템은 권장 경로·이륙 시각만 안내), 전방 차단 시 우회로 안내 승인, 진로방해 차량 통보 초안 검토, 에이전트 기록·질의 |
| `http://localhost:3000/crew` 소방차 태블릿 | 출동 소방대원 | 드론 영상 공유받아 보기, 우회로 안내, 다음 혼잡 구간·길 확보 상태·진로방해 차량 (보기 전용) |

지도는 실제 지도(OpenStreetMap, Leaflet — 키 없음)이고, 인터넷이 끊기면 개략도(SVG)로 자동 대체됩니다. 소방차 경로는 OSRM 으로 받은 실제 도로 모양(`src/data/roadGeometry.ts`, 1회 생성, 다시 만들 때 `node --experimental-strip-types scripts/fetch-roads.mjs .`)을 따라 그리고, 도착 시간·예상 지연·남은 거리도 그 실제 도로 거리로 계산합니다(`src/lib/road.ts` — 시나리오 1: 2.3km(우회 1.9km), 시나리오 2: 1.9km(다른 진입 경로 1.8km)). 구간 속도는 가정값입니다.

지도 바탕(타일)은 OpenStreetMap 서버에서 그때그때 받아 오므로 **시연 노트북에 인터넷이 필요합니다.** 인터넷이 없으면 6초 뒤 개략도로 바뀌고, IBM 에이전트도 MOCK 답으로 바뀝니다.

두 화면은 실시간으로 공유합니다 — 같은 브라우저는 `BroadcastChannel`, 다른 기기(노트북 ↔ 태블릿)는 서버 중계 `/api/sync`(Server-Sent Events). 콘솔의 [소방차 화면 열기] 버튼으로 새 창을 띄우거나, 서버 배포 후 태블릿에서 `/crew` 를 여세요.

## 실행

```
npm install
npm run dev        # http://localhost:3000  (소방차 화면 /crew)
npm run test:geo   # 투입 판단·도로 따라 정찰·선행 시간·탐지·우회로 판단·시범 18대 검증
```

## 시연 흐름

시나리오는 2개입니다 (드론은 각각 1대, 출동한 소방서에서 소방차 경로를 따라 앞서 정찰).

두 시나리오 모두 큰 간선도로(대남대로·서문대로 등)를 피해 **일반 시내 도로**로 다닙니다.

**시나리오 1 · 도로 막힘 → 더 빠른 길** (동부소방서(가상 위치, 양림동 천변좌로) → 남구 방림동 다세대주택, 퇴근길 18:07, 실제 도로 2.3km, 예상 도착 약 7분 40초)
1. [출동 시나리오 시작] → 드론 투입 판단(규칙 권고) → [드론 투입 승인] — 동부소방서 드론(DB-D01)이 소방차와 동시에 출발해 광주천 천변좌로를 따라 앞서 날아 방림 구간 상습정체에 1분 27초 먼저 도착
2. 드론이 정찰하다 T+1:20 에 **천변좌로 긴급 도로 공사로 차로 통제(가상)** 발견 → 우회로 카드: 그대로 가면 13:15 / 방림로·용대로로 돌아가면 8:16 (**4분 59초 단축**), 소방차가 방림로 갈림길에 닿는 T+2:18 전까지 판단
3. [우회로 안내 승인] → 소방차 화면에 "천변좌로에서 방림로로 우회전 → 방림삼거리 → 용대로 → 현장" 안내, 드론은 우회로로 가서 소방차보다 앞서 길을 확인

**시나리오 2 · 불법주차로 진입 곤란 → 다른 경로 + 통보 초안** (남부소방서(가상 위치, 독립로) → 남구 봉선동 공동주택, 출근길 08:12, 실제 도로 1.9km, 예상 도착 약 7분 41초)
1. [출동 시나리오 시작] → [드론 투입 승인] → 남부소방서 드론(NB-D01)이 소방차와 동시에 출발해 독립로·백운광장·봉선로를 따라 앞서 날아 백운광장~봉선동 구간에 56초 먼저 도착, 정찰
2. T+2:50 에 **현장 진입로(봉선2로) 불법주차 2대** 발견 → 다른 진입 경로 카드: 그대로 가면 11:10 / 봉선1로12번길·봉선로79번길 → 봉선2로19번길로 7:11 (**3분 59초 단축**), 소방차가 봉선로 갈림길에 닿는 T+4:12 전까지 판단
3. [우회로 안내 승인] → 소방차 화면에 다른 진입 경로 안내, 드론은 그 진입로로 가서 길을 확인, 동시에 주차 차량 2대(12가 3456, 75나 7712, 가상) 번호판 인식 → 통보 초안(에이전트, 근거 문서 표시) → [초안 복사]·[검토 완료]. **자동 통보·신고는 하지 않고**, 실제 통보는 담당자가 관할 지자체 시스템에서 별도로 진행. IBM 호출이 실패하면 한 번 다시 시도하고, 그래도 실패하면 코드 양식의 예비 초안을 "IBM 호출 실패 · 예비 초안"으로 표시([초안 다시 생성] 가능). 지도·드론 영상·소방차 화면의 번호판은 끝 두 자리를 가림(12가 34**)

질의 탭: "견인 지원 요청 근거는?" 등 → 지식 문서를 근거로 답하고 근거 문서 이름 표시

## 서버 배포 (Docker, 도메인)

### A. Cloudflare Tunnel (도메인이 Cloudflare 에 있을 때, 권장)

> 현재 시연 주소 `https://goldenwing.kyeongmin0212.com` 은 기존 Cloudflare 터널(Docker 안 cloudflared)에 경로를 하나 추가해 이 컴퓨터의 3000번 포트로 연결했습니다. 앱은 Docker 컨테이너 `goldenwing`(`docker-compose.local.yml`, `127.0.0.1:3000`, Docker Desktop 이 켜지면 같이 켜짐)으로 돕니다. cloudflared 가 Docker 안에서 돌기 때문에 Service URL 은 `http://host.docker.internal:3000` 입니다(`localhost` 는 컨테이너 자신을 가리킴). 컴퓨터·Docker Desktop 이 켜져 있어야 열립니다.
> - 처음·코드 바뀐 뒤: `docker compose -f docker-compose.local.yml up -d --build` / 끄기: `docker compose -f docker-compose.local.yml down`
> - 지금은 `.env.local` 의 `MOCK=1` 로 IBM 대신 내장 모의 응답을 씁니다(IBM API 키 만료). 새 키를 넣고 `MOCK=0` 으로 바꾼 뒤 `up -d --force-recreate` 하면 LIVE 로 돌아갑니다.

공인 IP·포트 개방·인증서 없이 앱을 돌리는 컴퓨터(서버 또는 노트북) 하나만 있으면 됩니다.

1. Cloudflare 대시보드 → 네트워킹 → 터널 → **새 터널 만들기**(cloudflared, 이름 예: `gj-wing`) → 설치 화면의 Docker 탭에 나오는 토큰을 복사
   - 다른 사이트용 기존 터널(예: 포트폴리오)에 커넥터로 붙이지 마세요. 그 터널의 모든 경로가 이 컴퓨터로도 나뉘어 들어와 다른 사이트가 깨질 수 있습니다.
2. 새 터널의 **경로(공개 호스트 이름) 추가**: `goldenwing.<도메인>` → 서비스 `HTTP`, URL `app:3000`
3. 앱을 돌릴 컴퓨터에서:

```
cp deploy.env.example .env      # TUNNEL_TOKEN, BASIC_AUTH_USER/PASS, WXO_* 직접 입력
docker compose -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.tunnel.yml logs -f cloudflared   # "Registered tunnel connection" 이 보이면 연결됨
```

터널 화면의 상태가 '정상', 활성 복제본 1 이 되면 `https://goldenwing.<도메인>` (상황실), `/crew` (소방차 화면) 로 접속합니다. 컴퓨터가 꺼지거나 잠자기에 들어가면 사이트도 멈춥니다.

### B. 공인 IP 서버 (Caddy 가 HTTPS 처리)

리눅스 서버에 Docker 와 Docker Compose 가 있으면:

```
# 1) 서버에 이 폴더 올리기 (git clone 또는 복사) — .env.local 은 올리지 않음
cp deploy.env.example .env      # DOMAIN, BASIC_AUTH_USER/PASS, WXO_* 를 서버에서 직접 입력
# 2) 도메인 DNS A 레코드 → 서버 공인 IP, 방화벽 80·443 열기
docker compose up -d --build    # 앱 + Caddy(HTTPS 인증서 자동 발급)
docker compose logs -f app      # 확인
```

- 상황실 `https://<도메인>`, 소방차 화면 `https://<도메인>/crew` (태블릿 등 다른 기기에서 열어도 따라감)
- `BASIC_AUTH_USER`·`BASIC_AUTH_PASS` 를 넣으면 접속 비밀번호가 켜집니다. 공개 서버라면 꼭 넣으세요 (IBM 호출 남용·화면 중계 위조 방지).
- 화면 중계는 서버 메모리에 최신 상태 1개만 두므로 앱 컨테이너는 1개로 운영합니다.
- 업데이트: 새 코드 받은 뒤 `docker compose up -d --build`

## IBM watsonx Orchestrate 연동

- `.env.example` 을 `.env.local` 로 복사해 `WXO_ENDPOINT_URL`, `WXO_API_KEY`, `WXO_AGENT_NAME` 을 채우면 LIVE, 비우면 MOCK.
- 키는 서버 라우트(`src/app/api/agent/route.ts`)에서만 쓰며 브라우저로 보내지 않습니다. `NEXT_PUBLIC_` 을 붙이지 마세요.
- 처음 연결·업로드: `orchestrate/live_setup.ps1 -Prefix <팀이니셜>` (팀 접두사 `goldenwing` 으로 업로드됨).
- CLI 로그인 토큰은 약 1시간 — 만료되면 `orchestrate env activate gjw_edu --api-key <키>` 후 다시 실행.
- 감독 에이전트는 Live 배포됨. **지식·도구·협업 에이전트를 고친 뒤에는 다시 배포해야 Live 에 반영됩니다:**
  `orchestrate\.venv\Scripts\orchestrate.exe agents deploy --name goldenwing_gjw_supervisor`
- 로컬 도구 점검: `py -3.12 -I -X utf8 orchestrate/gjw_tools.py` / LIVE 시험: `orchestrate\.venv\Scripts\python.exe -I -X utf8 orchestrate/eval_live.py`

## 지식(RAG) 문서 5개 — `gjw_rules_kb`

Orchestrate 가 문서를 나눠 임베딩해 벡터 색인에 넣고, 질문과 가까운 문단을 찾아 근거로 답합니다.

| 파일 | 내용 |
|---|---|
| `orchestrate/gjw_law_text.txt` | 관련 법령 조문 원문 발췌 (국가법령정보센터 현행본, 2026-11-20 열람) |
| `orchestrate/gjw_rules_doc.txt` | 단속 규정 요약 |
| `orchestrate/gjw_drone_sop.txt` | 드론 선행 출동 운용 절차서 (가상) |
| `orchestrate/gjw_report_form.txt` | 지자체 통보 양식과 작성 요령 (가상) — 초안만, 담당자가 별도 통보 |
| `orchestrate/gjw_procedure.txt` | 시제품 사용 절차 (가상) — 투입 승인 → 동시 출발 → 막힘 발견 → 우회로 승인 → 통보 초안 검토 |

시험 기록: `orchestrate/eval_results_run*.csv` → 최종 `eval_results.csv` (10문항 10/10, 실패·수정 이력 포함).

## 구조

| 경로 | 내용 |
|---|---|
| `src/app/page.tsx`, `src/app/crew/page.tsx` | 상황실 콘솔, 소방차 태블릿 |
| `src/lib/useGoldenTimeSim.ts` | 콘솔 상태·이벤트·에이전트 호출, 소방차 화면으로 상태 공유 |
| `src/lib/simBridge.ts`, `src/lib/simView.ts` | 화면 간 공유 채널, 두 화면 공용 상태 타입 |
| `src/lib/dispatch.ts` | 드론 투입 규칙 (지연 ≥3분 또는 혼잡 DB 지점 → 1~2대), 배차 (출동 소방서 드론 우선, 운용반경 10km) |
| `src/lib/geo.ts` | 거리·시간 계산, 관할 매핑(전남광주통합특별시 표기). 회피구역 A* 는 남겨 두었고 지금은 쓰지 않음(추후 보완) |
| `src/lib/road.ts` | 실제 도로 선 위 거리·위치, 우회로를 넣은 경로 만들기 |
| `src/lib/simulation.ts` | 소방차·드론 타임라인(드론은 소방차 도로를 따라 정찰), 이륙 시각 조정(목표 선행 4분, 정찰 구간이 가까우면 짧아짐), 전방 차단 발견·우회 비교, 탐지 시각 |
| `src/lib/wxo.ts`, `src/app/api/agent/route.ts` | Orchestrate REST 연동, 근거 문서 추출, MOCK 전환 |
| `src/data/*` | 혼잡 DB, 드론 거점(소방서 6곳 × 3대 = 18대, 가상 위치), 시나리오 2개(도로 막힘·불법주차, 각각 우회로 포함), 실제 도로 모양. 공역 DB(관제권·회피구역)는 보관만 — 추후 보완 |
| `src/app/api/sync/route.ts`, `src/middleware.ts` | 다른 기기 화면 중계, 접속 비밀번호(선택) |
| `Dockerfile`, `docker-compose.yml`, `Caddyfile`, `deploy.env.example` | 서버 배포 |
| `orchestrate/` | 에이전트 YAML 5개, Python 도구 6개, 지식 문서 5개, 업로드·LIVE 설정·시험 스크립트 |

공식 출처는 `G-J_골든타임윙_참고자료_출처.md`(공유폴더\취업\02. 프로젝트\06. IBM AI) 참고.
