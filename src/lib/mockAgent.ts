// 내장 시뮬레이션 에이전트 (MOCK) — IBM 연결이 없을 때도 같은 시연 흐름을 보장한다.

import type { AgentRequest, AgentResponse } from "../types/drone.ts";
import { buildReportDraft, makeReceiptNo } from "./report.ts";

export function mockAgent(req: AgentRequest, fallbackReason?: string): AgentResponse {
  if (req.type === "violation_detected") {
    const draft = buildReportDraft(req.violation);
    return {
      mode: "mock",
      fallbackReason,
      status: "pending",
      draft,
      steps: [
        { agent: "vision", text: `[${req.violation.plate}] 탐지 이벤트 수신 (신뢰도 ${(req.violation.confidence * 100).toFixed(0)}%)`, delayMs: 600 },
        { agent: "report", text: `[${req.violation.plate}] ① 번호판 형식 검증 — 고시 형식 일치 (가상 번호)`, delayMs: 1200 },
        { agent: "report", text: `[${req.violation.plate}] ② 관할 지자체 매핑 — ${draft.jurisdictionShort}(${draft.jurisdictionCode}) → ${draft.agency}`, delayMs: 1400 },
        { agent: "report", text: `[${req.violation.plate}] ③ 법적 근거 조회 — ${draft.legalBasis.length}건 (지식: 단속 규정 요약)`, delayMs: 1300 },
        { agent: "report", text: `[${req.violation.plate}] ④ 지자체 통보 양식 초안 작성 완료 (사진 2장·GPS·해시) — 사람 승인 대기`, delayMs: 1500 },
      ],
      message: `[${req.violation.plate}] 신고서 초안을 작성했습니다. 위반 여부와 처분은 판단하지 않았으며, [신고 승인] 시 ${draft.agency}에 통보·연계합니다.`,
    };
  }
  if (req.type === "report_approved") {
    const receiptNo = makeReceiptNo();
    return {
      mode: "mock",
      fallbackReason,
      status: "submitted",
      receiptNo,
      steps: [
        { agent: "report", text: `[${req.draft.plate}] 관제요원 승인 확인 — 증거 패키지 암호화·첨부`, delayMs: 800 },
        { agent: "report", text: `${req.draft.agency} 단속 시스템으로 통보·연계 (시뮬레이션)`, delayMs: 1400 },
        { agent: "report", text: `접수 완료 — 접수번호 ${receiptNo}`, delayMs: 900 },
      ],
      message: `신고·견인 요청이 접수되었습니다(시뮬레이션). 접수번호 ${receiptNo}. 처분 결정은 관할 담당자가 합니다.`,
    };
  }
  // chat
  const q = req.message;
  let answer = "문서에서 확인할 수 없음 — 담당자 확인이 필요합니다.";
  if (/금지|공항|회피/.test(q)) answer = "회피구역(활주로 진입·이륙 회랑, 송전선로, 군사시설) DB와 직선 경로를 대조해 겹치면 안전거리 350m를 두고 우회 경로를 계산합니다. 광주공항 관제권(9.3km)은 금지가 아니라 승인 대상이고 긴급비행 특례도 승인을 면제하지 않습니다. 관제기관과 사전 협의된 경우 사전 통보 시 승인 간주(항공안전법 제127조④, 시행규칙 제308조⑧)되며, 비행 후 승인신청서를 냅니다.";
  else if (/소화전|5m|5 m/.test(q)) answer = "도로교통법 제32조에 따라 소방용수시설 5m 이내는 정차·주차 금지 구역입니다(공개 법령 요약). 실제 처분 여부는 관할 지자체가 판단합니다.";
  else if (/과태료|견인|불법|위반이야|처벌/.test(q)) answer = "위반 확정이나 과태료·견인 결정은 제가 하지 않습니다. 증거와 초안을 정리해 드리고, 최종 판단은 관할 담당자가 합니다.";
  else if (/도착|ETA|몇 분/.test(q)) answer = "현재 시나리오 기준 드론은 소방차보다 정체 구간에 먼저 도착합니다(지도 우측 하단 ETA 비교 참고, 시뮬레이션 가정값).";
  return {
    mode: "mock",
    fallbackReason,
    steps: [{ agent: "watsonx", text: "질의 처리 중 (MOCK)", delayMs: 700 }],
    message: answer,
  };
}
