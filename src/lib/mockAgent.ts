// 내장 시뮬레이션 에이전트 (MOCK) — IBM 연결이 없을 때도 같은 시연 흐름을 보장한다.

import type { AgentRequest, AgentResponse } from "../types/drone.ts";
import { buildReportDraft } from "./report.ts";

export function mockAgent(req: AgentRequest, fallbackReason?: string): AgentResponse {
  if (req.type === "violation_detected") {
    const draft = buildReportDraft(req.violation);
    return {
      mode: "mock",
      fallbackReason,
      status: "pending",
      draft,
      sources: ["관련 법령 조문 원문 발췌", "지자체 통보 양식과 작성 요령"],
      steps: [
        { agent: "vision", text: `[${req.violation.plate}] 탐지 이벤트 수신 (신뢰도 ${(req.violation.confidence * 100).toFixed(0)}%)`, delayMs: 600 },
        { agent: "report", text: `[${req.violation.plate}] ① 번호판 형식 검증 — 고시 형식 일치 (가상 번호)`, delayMs: 1200 },
        { agent: "report", text: `[${req.violation.plate}] ② 관할 지자체 매핑 — ${draft.jurisdictionShort}(${draft.jurisdictionCode}) → ${draft.agency}`, delayMs: 1400 },
        { agent: "report", text: `[${req.violation.plate}] ③ 법적 근거 조회 — ${draft.legalBasis.length}건 (지식: 단속 규정 요약)`, delayMs: 1300 },
        { agent: "report", text: `[${req.violation.plate}] ④ 지자체 통보 양식 초안 작성 완료 (사진 2장·GPS·해시) — 관제요원 검토 대기`, delayMs: 1500 },
      ],
      message: `[${req.violation.plate}] 통보 초안을 작성했습니다. 위반 여부와 처분은 판단하지 않았습니다. 자동으로 통보하지 않으며, 검토 후 담당자가 ${draft.agency}에 직접 통보합니다.`,
    };
  }
  // chat — 지식 문서를 근거로 답하는 흉내 (LIVE 에서는 Orchestrate 지식 RAG 가 실제로 답함)
  const q = req.message;
  let answer = "등록된 문서에 없는 내용이라 안내할 수 없습니다. 담당자에게 확인해 주세요.";
  let sources: string[] = [];
  if (/과태료|벌금|얼마/.test(q)) {
    answer = "과태료 금액이나 부과 여부는 제가 판단하지 않습니다. 증거와 통보 초안을 정리해 드리고, 최종 판단은 관할 지자체 담당자가 합니다.";
  } else if (/견인/.test(q)) {
    answer = "소방기본법 제25조제4항: 소방활동에 방해가 되는 주정차 차량의 제거·이동을 위해 관할 지자체 등에 견인차량과 인력 지원을 요청할 수 있고, 요청받은 기관은 정당한 사유가 없으면 협조해야 합니다. 요청 여부는 현장 지휘관이 판단합니다.";
    sources = ["관련 법령 조문 원문 발췌"];
  } else if (/관제권|비행|드론|공항|회피|금지/.test(q)) {
    answer = "관제권(광주공항 반경 9.3km)은 회피구역이 아니라 비행승인 대상입니다. 화재 대응 긴급 비행은 항공안전법 제131조의2제2항에 해당하고, 사전에 국토교통부장관에게 알리면 비행승인을 받은 것으로 봅니다(제127조제4항). (시연에서는 비행 제한 구역을 경로에 반영하지 않았고, 추후 보완 예정입니다.)";
    sources = ["관련 법령 조문 원문 발췌", "드론 선행 출동 운용 절차서"];
  } else if (/통보|초안|검토|구청|신고|누가/.test(q)) {
    answer = "이 시제품에서 에이전트는 지자체 통보 초안만 작성합니다. 관제요원이 초안을 검토·보관([검토 완료])하고, 실제 통보는 담당자가 관할 지자체 시스템에서 별도로 진행합니다. 시스템은 자동으로 통보·신고하지 않으며, 위반 확정·과태료·견인 결정은 지자체가 합니다.";
    sources = ["지자체 통보 양식과 작성 요령"];
  } else if (/양보|진로/.test(q)) {
    answer = "도로교통법 제29조제4항: 교차로나 그 부근에서 긴급자동차가 접근하면 차마와 노면전차의 운전자는 교차로를 피하여 일시정지해야 하고, 제5항: 그 밖의 곳에서는 긴급자동차가 우선통행할 수 있도록 진로를 양보해야 합니다.";
    sources = ["관련 법령 조문 원문 발췌"];
  } else if (/소화전|5m|5 m|주정차|주차/.test(q)) {
    answer = "도로교통법 제32조제6호: 소방용수시설 또는 비상소화장치가 설치된 곳으로부터 5미터 이내에는 정차·주차할 수 없습니다. 실제 처분 여부는 관할 지자체가 판단합니다.";
    sources = ["관련 법령 조문 원문 발췌"];
  } else if (/도착|몇 분|ETA/.test(q)) {
    answer = "드론은 소방차보다 약 4분 먼저 혼잡 구간에 도착하도록 이륙 시각을 맞춥니다(시뮬레이션 가정값).";
    sources = ["드론 선행 출동 운용 절차서"];
  }
  return {
    mode: "mock",
    fallbackReason,
    sources,
    steps: [{ agent: "watsonx", text: "질의 처리 중 (시뮬레이션)", delayMs: 700 }],
    message: answer,
  };
}
