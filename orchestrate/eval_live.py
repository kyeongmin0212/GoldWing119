"""LIVE 시험: eval_questions.csv 8문항을 Orchestrate 감독 에이전트에 보내 답·응답 시간을 eval_results.csv 로 저장.
키·URL 은 ../.env.local 에서 읽고 화면에 출력하지 않는다. 표준 라이브러리만 사용.
실행: .venv\\Scripts\\python.exe -I -X utf8 eval_live.py
"""
import csv
import json
import time
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENV = {}
for line in (HERE.parent / ".env.local").read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.lstrip().startswith("#"):
        k, v = line.split("=", 1)
        ENV[k.strip()] = v.strip()

BASE = ENV.get("WXO_ENDPOINT_URL", "").rstrip("/")
KEY = ENV.get("WXO_API_KEY", "")
NAME = ENV.get("WXO_AGENT_NAME", "")
if not (BASE and KEY and (NAME or ENV.get("WXO_AGENT_ID"))):
    raise SystemExit(".env.local 에 WXO_ENDPOINT_URL, WXO_API_KEY, WXO_AGENT_NAME 이 필요합니다 (live_setup.ps1 실행).")


def http(url, data=None, headers=None, timeout=180):
    req = urllib.request.Request(url, data=data, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:  # URL 은 출력하지 않음
        raise SystemExit(f"HTTP {e.code} — 인증(401/403)이나 에이전트 이름(404)을 확인하세요.") from None


tok = http("https://iam.cloud.ibm.com/identity/token",
           urllib.parse.urlencode({"grant_type": "urn:ibm:params:oauth:grant-type:apikey", "apikey": KEY}).encode(),
           {"Content-Type": "application/x-www-form-urlencoded"}, 30)["access_token"]
H = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

agent_id = ENV.get("WXO_AGENT_ID")
if not agent_id:
    data = http(f"{BASE}/v1/orchestrate/agents", headers=H, timeout=30)
    items = data if isinstance(data, list) else data.get("assistants") or data.get("agents") or []
    agent_id = next((a["id"] for a in items if a.get("name") == NAME), None)
    if not agent_id:
        raise SystemExit(f"에이전트 '{NAME}' 을 찾지 못했습니다. live_setup.ps1 업로드를 확인하세요.")

rows = list(csv.DictReader((HERE / "eval_questions.csv").open(encoding="utf-8")))
out = []
for r in rows:
    t0 = time.time()
    d = http(f"{BASE}/v1/orchestrate/{agent_id}/chat/completions",
             json.dumps({"messages": [{"role": "user", "content": r["질문"]}], "stream": False}).encode(), H)
    c = (d.get("choices") or [{}])[0].get("message", {}).get("content", "")
    if isinstance(c, list):  # 조각 리스트로 오는 경우 텍스트만 이어 붙임
        c = "".join(p if isinstance(p, str) else str((p or {}).get("text", "")) for p in c)
    ans = c or json.dumps(d, ensure_ascii=False)[:300]
    sec = round(time.time() - t0, 1)
    out.append({**r, "실제 답": ans.replace("\n", " "), "응답 시간(초)": sec, "통과/실패": "", "고친 곳": ""})
    print(f"[{r['번호']}] {r['유형']} ({sec}s) {ans[:120].replace(chr(10), ' ')}…")

with (HERE / "eval_results.csv").open("w", encoding="utf-8-sig", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
    w.writeheader()
    w.writerows(out)
print(f"\n저장: eval_results.csv — '기대하는 행동'과 비교해 통과/실패 칸을 채우세요. 평균 응답 {sum(o['응답 시간(초)'] for o in out) / len(out):.1f}s")
