// 신고서 초안 생성 — 결정적 코드 (관할 매핑·법적 근거·양식). 모델은 문장 다듬기만 담당.

import type { ReportDraft, ViolationSample } from "../types/drone.ts";
import { formatLatLng, mapJurisdiction } from "./geo.ts";

/** 시연용 원본 파일 해시 표시 (실서비스는 촬영 원본의 SHA-256) */
function demoHash(seed: string): string {
  let h = 2166136261;
  let out = "";
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i) ^ r, 16777619);
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

// 국가법령정보센터 현행본 기준 (2026-11-20 확인: 도로교통법 시행 2026.10.13, 소방기본법 시행 2026.9.3)
const LEGAL: { match: RegExp; basis: string }[] = [
  { match: /소화전/, basis: "도로교통법 제32조 제6호 — 소방용수시설·비상소화장치 5m 이내 정차·주차 금지" },
  { match: /전용구역/, basis: "소방기본법 제21조의2 제2항 — 소방자동차 전용구역 주차·진입 방해 금지" },
  { match: /진로 방해|긴급차량/, basis: "소방기본법 제21조 제3항 — 출동 중인 소방자동차의 진로 양보 거부·끼어들기·가로막기 등 출동 방해 금지" },
  { match: /진로 방해|긴급차량/, basis: "도로교통법 제29조 제4·5항 — 긴급자동차 접근 시 일시정지·진로 양보" },
  { match: /교차로|모퉁이/, basis: "도로교통법 제32조 제2호 — 교차로 가장자리·도로 모퉁이 5m 이내 정차·주차 금지" },
];

export function legalBasisFor(reason: string): string[] {
  const out = LEGAL.filter((l) => l.match.test(reason)).map((l) => l.basis);
  return out.length ? out : ["문서에서 확인할 수 없음 — 담당자 확인 필요"];
}

export function buildReportDraft(v: ViolationSample & { detectedAtIso: string }): ReportDraft {
  const j = mapJurisdiction(v.position);
  const when = new Date(v.detectedAtIso);
  const detectedAt = isNaN(when.getTime())
    ? v.detectedAtIso
    : when.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", hour12: false });
  const legalBasis = legalBasisFor(v.reason);
  return {
    title: `[긴급출동 진로방해 차량 — 관할 지자체 통보] ${v.plate} (가상)`,
    jurisdiction: j.name,
    jurisdictionShort: j.short,
    jurisdictionCode: j.code,
    agency: j.agency,
    plate: v.plate,
    location: v.locationLabel,
    coords: formatLatLng(v.position),
    detectedAt,
    violation: v.reason,
    legalBasis,
    requestedAction: "과태료 부과 검토, 필요 시 소방기본법 제25조 제4항에 따른 견인차량·인력 지원 요청 (견인 필요 여부는 현장 지휘관, 처분은 관할 지자체 담당자 판단)",
    evidence: [
      `같은 위치·각도 1분 간격 사진 2장 (호버링 촬영, OCR 신뢰도 ${(v.confidence * 100).toFixed(0)}%)`,
      `GPS ${formatLatLng(v.position)} / 타임스탬프 ${detectedAt}`,
      `원본 파일 해시 SHA-256 ${demoHash(v.id + v.detectedAtIso).slice(0, 16)}… (시연값)`,
      "얼굴 자동 블러 처리본 첨부",
    ],
    body:
      `119 긴급출동 중 선행 드론이 ${v.locationLabel}에서 ${v.vehicleType} ${v.plate}(가상)을 포착했습니다. ` +
      `위반 의심 사유는 '${v.reason}'입니다. 소방 출동 연계 촬영 자료(사진 2장·좌표·해시)를 관할 지자체에 통보하며, 위반 여부와 처분은 ${j.agency} 담당자의 확인을 요청드립니다.`,
  };
}

export function makeReceiptNo(): string {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  return `GJ-${ymd}-${Math.floor(1000 + Math.random() * 9000)} (MOCK)`;
}
