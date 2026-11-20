// 비행 제한 공간 DB (시연용)
// - 관제권(CONTROL_ZONES): 항공안전법상 "비행 승인 필요" 구역. 금지가 아니라 승인·관제탑 협의 대상.
//   근거: 국토교통부 — 관제권은 비행장 중심 반경 5NM(9.3km). https://www.molit.go.kr/USR/policyTarget/dtl.jsp?idx=584
// - 회피구역(NO_FLY_ZONES): 드론이 경로 계산에서 원천 배제하는 구역.
//   활주로 진입·이륙 경로는 시연용 가정 폴리곤, 송전선로·군사시설은 가상입니다.
//   실제 공역은 드론 원스톱 민원서비스(https://drone.onestop.go.kr)에서 확인해야 합니다.

import type { ControlZone, LatLng, NoFlyZone } from "../types/drone.ts";

const AIRPORT: LatLng = { lat: 35.1264, lng: 126.8089 }; // 광주공항 (공개 지도 기준 개략)

/** 방위각(도, 북=0 시계방향) 방향 직사각형 회랑 */
function corridor(center: LatLng, bearingDeg: number, halfLenKm: number, halfWidthKm: number): LatLng[] {
  const b = (bearingDeg * Math.PI) / 180;
  const u = { e: Math.sin(b), n: Math.cos(b) }; // 길이 방향
  const v = { e: Math.cos(b), n: -Math.sin(b) }; // 폭 방향
  const pt = (l: number, w: number): LatLng => ({
    lat: center.lat + (l * u.n + w * v.n) / 111.0,
    lng: center.lng + (l * u.e + w * v.e) / 91.2,
  });
  return [pt(halfLenKm, halfWidthKm), pt(halfLenKm, -halfWidthKm), pt(-halfLenKm, -halfWidthKm), pt(-halfLenKm, halfWidthKm)];
}

export const CONTROL_ZONES: ControlZone[] = [
  {
    id: "CTR-01",
    name: "광주공항 관제권 (반경 9.3km)",
    center: AIRPORT,
    radiusKm: 9.3,
    note: "비행 승인·관제탑 협의 필요. 긴급 공공목적 비행은 지방항공청 통보 절차(시행규칙 개정안, 시행 여부 확인 필요)",
  },
];

export const NO_FLY_ZONES: NoFlyZone[] = [
  {
    id: "NFZ-01",
    name: "활주로 진입·이륙 경로 (가정)",
    kind: "runway",
    polygon: corridor(AIRPORT, 40, 4.5, 0.8),
    note: "광주공항 활주로 방향(북동-남서) 기준 시연용 가정 회랑",
  },
  {
    id: "NFZ-02",
    name: "송전선로 보호구역 (가상)",
    kind: "powerline",
    polygon: [
      { lat: 35.082, lng: 126.812 },
      { lat: 35.089, lng: 126.812 },
      { lat: 35.066, lng: 126.876 },
      { lat: 35.059, lng: 126.876 },
    ],
    note: "가상 고압 송전선로 회랑 — 시연용",
  },
  {
    id: "NFZ-03",
    name: "군사시설 보호구역 (가상)",
    kind: "military",
    polygon: [
      { lat: 35.2, lng: 126.9 },
      { lat: 35.215, lng: 126.925 },
      { lat: 35.2, lng: 126.95 },
      { lat: 35.185, lng: 126.925 },
    ],
    note: "가상 군사시설 — 시연용",
  },
];
