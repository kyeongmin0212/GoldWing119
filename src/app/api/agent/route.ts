// 대시보드 ↔ IBM watsonx Orchestrate 이벤트 브리지
// - LIVE: .env.local 에 WXO_* 가 있으면 Orchestrate 수퍼바이저 에이전트를 호출
// - MOCK: 미설정·오류·타임아웃이면 내장 시뮬레이션 에이전트로 자동 전환 (같은 응답 스키마)
// 관할 매핑·법적 근거·양식은 항상 코드(report.ts)가 결정하고, 에이전트는 문장(설명·초안)만 담당한다.

import { NextResponse } from "next/server";
import type { AgentHealth, AgentRequest, AgentResponse } from "@/types/drone";
import { mockAgent } from "@/lib/mockAgent";
import { friendlyNoDocAnswer } from "@/lib/noDocAnswer";
import { buildReportDraft, checkModelSentences, draftFactSentence } from "@/lib/report";
import { askAgent, lastJson, mask, pingAgent, wxoConfigured } from "@/lib/wxo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function failReason(e: unknown): string {
  if (e instanceof Error && e.name === "AbortError") return "응답 시간 초과";
  const msg = e instanceof Error ? e.message : String(e);
  if (msg === "fetch failed") return "IBM 서버에 접속할 수 없음 (인터넷 연결·주소 확인)";
  return mask(msg);
}

// 연결 확인 결과는 20초 동안 재사용 (여러 화면이 동시에 물어도 IBM 요청은 한 번)
let health: { at: number; res: AgentHealth } | null = null;

/** 연결 확인 — 설정만 보지 않고 IBM 에 실제로 요청해 본다 */
export async function GET() {
  if (!wxoConfigured()) return NextResponse.json({ mode: "mock", checkedAt: new Date().toISOString(), reason: "IBM 연결 정보 미설정" } satisfies AgentHealth);
  if (health && Date.now() - health.at < 20_000) return NextResponse.json(health.res);
  let res: AgentHealth;
  try {
    await pingAgent();
    res = { mode: "live", checkedAt: new Date().toISOString() };
  } catch (e) {
    res = { mode: "offline", checkedAt: new Date().toISOString(), reason: failReason(e) };
  }
  health = { at: Date.now(), res };
  return NextResponse.json(res);
}

function eventPrompt(req: AgentRequest): string {
  if (req.type === "violation_detected") {
    const draft = buildReportDraft(req.violation);
    return [
      "[대시보드 이벤트] 선행 드론이 긴급출동 진로 방해 의심 차량을 탐지했습니다.",
      "아래 JSON 은 코드가 계산한 사실입니다. 차량·위치·관측 시각·의심 사유를 적는 첫 문장은 코드가 직접 넣습니다.",
      "당신은 그 뒤에 붙일 지자체 통보 초안 문장 1~2개만 작성하세요: 촬영 자료를 관할 지자체에 통보하려 한다는 것, 위반 여부·과태료·견인은 담당자 확인이 필요하다는 것. 초안만 작성하며 통보·신고는 하지 않습니다.",
      "날짜·시각·번호판·주소는 쓰지 마세요. 위반을 확정하지 말고 '의심됩니다'처럼 쓰세요.",
      '마지막 줄에 {"status":"pending","body":"<초안 문장>"} JSON 한 줄을 출력하세요.',
      JSON.stringify({
        event: "violation_detected",
        plate: req.violation.plate + " (가상)",
        vehicle: req.violation.vehicleType,
        reason: req.violation.reason,
        location: req.violation.locationLabel,
        coords: draft.coords,
        detected_at: draft.detectedAt,
        jurisdiction: draft.jurisdiction,
        jurisdiction_code: draft.jurisdictionCode,
        agency: draft.agency,
        legal_basis: draft.legalBasis,
        ocr_confidence: req.violation.confidence,
      }),
    ].join("\n");
  }
  return req.context ? `${req.message}\n\n[대시보드 상황]\n${req.context}` : req.message;
}

function stripJsonLine(text: string): string {
  return text.replace(/\{[^{}]*"status"[^{}]*\}\s*$/, "").trim();
}

/** RAG 출처 뽑기: 지식 인용 표식【…】과 '근거 문서: …' 줄을 모아 본문에서 뺀다 */
function extractSources(text: string): { clean: string; sources: string[] } {
  const found = new Set<string>();
  let clean = text.replace(/【([^】]+)】/g, (_m, s: string) => {
    found.add(`지식 ${s.replace(/^[a-z0-9]+_(?=gjw_)/, "")}`);
    return "";
  });
  clean = clean.replace(/(?:^|\n)\s*\**근거 문서\**\s*[:：]\s*([^\n]+)/g, (_m, list: string) => {
    list
      .split(/[,·、/]/)
      .map((x) => x.replace(/[*'"「」]/g, "").trim())
      .filter(Boolean)
      .forEach((x) => found.add(x));
    return "";
  });
  // 화면은 마크다운을 그리지 않으므로 굵게(**) 표시만 지운다
  clean = clean.replace(/\*\*/g, "");
  return { clean: clean.trim(), sources: [...found] };
}

export async function POST(request: Request) {
  let req: AgentRequest;
  try {
    req = (await request.json()) as AgentRequest;
  } catch {
    return NextResponse.json({ error: "잘못된 요청" }, { status: 400 });
  }

  if (!wxoConfigured()) {
    return NextResponse.json(mockAgent(req, "IBM 연결 정보 미설정 (MOCK 모드)"));
  }

  try {
    const started = Date.now();
    const { text, threadId } = await askAgent(eventPrompt(req), req.threadId);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    health = { at: Date.now(), res: { mode: "live", checkedAt: new Date().toISOString() } };
    const json = lastJson(text);
    const { clean, sources } = extractSources(stripJsonLine(text));

    let res: AgentResponse;
    if (req.type === "violation_detected") {
      const draft = buildReportDraft(req.violation);
      // 첫 문장(번호판·위치·관측 시각)은 코드가 넣고, 모델 문장은 검사를 통과할 때만 뒤에 붙인다
      const raw = typeof json?.body === "string" && json.body.trim() ? extractSources(json.body).clean : clean;
      const checked = checkModelSentences(raw);
      if (checked.ok) draft.body = `${draftFactSentence(req.violation, draft.detectedAt)} ${checked.text}`;
      res = {
        mode: "live",
        threadId,
        status: "pending",
        draft,
        sources,
        message: checked.ok ? clean || "통보 초안이 작성되었습니다." : `[${draft.plate}] 통보 초안 작성 — 모델 문장 검사 탈락(${checked.why}) → 코드 초안 사용`,
        steps: [
          { agent: "report", text: `관할 매핑(코드): ${draft.jurisdictionShort}(${draft.jurisdictionCode}) → ${draft.agency}`, delayMs: 300 },
          { agent: "watsonx", text: `Orchestrate 수퍼바이저 응답 수신 (${secs}s) — 초안 본문 작성`, delayMs: 400 },
          ...(checked.ok ? [] : [{ agent: "report" as const, text: `모델 문장 검사 탈락(${checked.why}) → 코드 초안 사용 (번호판·위치·관측 시각은 관측값)`, delayMs: 300 }]),
          { agent: "report", text: "통보 초안 완료 — 관제요원 검토 대기 (자동 통보 없음)", delayMs: 300 },
        ],
      };
    } else {
      res = { mode: "live", threadId, sources, message: friendlyNoDocAnswer(clean || text, req.message), steps: [{ agent: "watsonx", text: `응답 (${secs}s)`, delayMs: 200 }] };
    }
    return NextResponse.json(res);
  } catch (e) {
    const reason = failReason(e);
    health = { at: Date.now(), res: { mode: "offline", checkedAt: new Date().toISOString(), reason } };
    return NextResponse.json({ ...mockAgent(req, `LIVE 호출 실패 → MOCK 전환: ${reason}`), offline: true } satisfies AgentResponse);
  }
}
