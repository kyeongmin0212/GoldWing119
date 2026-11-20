// 광주 시내 출동 시나리오 (시연용 가상 데이터) — 두 시나리오 모두 큰 간선도로(대남대로·서문대로 등)를 피해 일반 시내 도로로 다닌다.
// 지명·좌표는 공개 지도(OpenStreetMap) 기준 개략값, 구간 속도는 가정값, 차량번호·신고 내용은 모두 가상입니다.
// 번호판 형식: 국토교통부 「자동차 등록번호판 등의 기준에 관한 고시」 차종 분류기호(승합 70~79, 화물 80~97/800~979)

import type { Scenario, ScenarioMode } from "../types/drone.ts";

const STATION = { name: "서부소방서 양동119안전센터 (가상 위치)" };

export const SCENARIOS: Record<ScenarioMode, Scenario> = {
  urban: {
    mode: "urban",
    title: "시나리오 2 · 불법주차로 진입 곤란 → 다른 경로 안내 + 통보 초안 — 남구 봉선동 공동주택 화재 (출근길)",
    description: "양동에서 출동, 독립로·봉선로를 지나 현장 진입로(봉선2로) 불법주차 2대로 소방차 진입 곤란",
    focus: "드론이 진입로 불법주차를 발견 → 다른 진입 경로 안내, 주차 차량은 지자체 통보 초안",
    station: { ...STATION, position: { lat: 35.15207, lng: 126.90246 } },
    incident: {
      name: "남구 봉선동 공동주택",
      position: { lat: 35.12655, lng: 126.90989 },
      type: "공동주택 화재 신고 (가상)",
      reportedAt: "08:12",
    },
    truckStart: { lat: 35.15207, lng: 126.90246 },
    truckRoute: [
      { to: { lat: 35.14887, lng: 126.90415 }, speedKmh: 25, label: "구성로", freeFlowKmh: 35 },
      { to: { lat: 35.1335, lng: 126.90141 }, speedKmh: 20, label: "독립로 출근길 서행", congested: true, freeFlowKmh: 40 },
      { to: { lat: 35.127, lng: 126.90538 }, speedKmh: 18, label: "백운광장 지나 봉선로 출근길 서행", congested: true, hotspotId: "H-BU", freeFlowKmh: 40 },
      { to: { lat: 35.12655, lng: 126.90989 }, speedKmh: 10, label: "봉선로 → 봉선2로 · 현장 진입로 (불법주정차 다발)", congested: true, hotspotId: "H-BS", freeFlowKmh: 25 },
    ],
    // 드론이 정찰하다 발견 → 관제요원이 다른 진입 경로 안내 여부 판단, 주차 차량은 통보 초안
    blockage: {
      kind: "parking",
      segIndex: 3,
      position: { lat: 35.12545, lng: 126.90706 },
      label: "봉선2로 불법주차 2대 — 소방차 진입 곤란 (가상)",
      short: "불법주차 · 진입 곤란",
      blockedSpeedKmh: 5,
      detour: {
        fromSeg: 3,
        via: [
          { lat: 35.1271, lng: 126.90599 },
          { lat: 35.12657, lng: 126.90657 },
        ],
        summary: "봉선로에서 봉선1로12번길로 좌회전 → 봉선로79번길 → 봉선2로19번길로 현장 진입",
        segments: [{ to: { lat: 35.12655, lng: 126.90989 }, speedKmh: 10, label: "봉선1로12번길 · 봉선로79번길 (다른 진입 경로)", congested: true, freeFlowKmh: 25 }],
      },
    },
    violations: [
      {
        id: "V-U1",
        plate: "12가 3456",
        vehicleType: "승용차 (흰색 SUV)",
        reason: "긴급차량 진로 방해 / 소화전 5m 이내 주정차",
        position: { lat: 35.12545, lng: 126.90701 },
        locationLabel: "전남광주통합특별시 남구 봉선동 봉선2로 현장 진입로 (가상 지점)",
        confidence: 0.94,
      },
      {
        id: "V-U2",
        plate: "75나 7712",
        vehicleType: "승합차 (회색)",
        reason: "소방자동차 전용구역 주차 (공동주택 진입로)",
        position: { lat: 35.12546, lng: 126.90712 },
        locationLabel: "전남광주통합특별시 남구 봉선동 공동주택 진입로 (가상 지점)",
        confidence: 0.88,
      },
    ],
  },
  regional: {
    mode: "regional",
    title: "시나리오 1 · 도로 막힘 → 더 빠른 길 안내 — 양동 → 남구 방림동 주택 화재 (퇴근길)",
    description: "광주천 천변좌로 퇴근길 정체 구간, 드론이 앞서 정찰하다 추돌사고로 길이 막힌 것을 발견",
    focus: "처음 안내한 천변좌로 대신 더 빠른 길(방림로·용대로)로 소방차 안내",
    station: { ...STATION, position: { lat: 35.15194, lng: 126.90359 } },
    incident: {
      name: "남구 방림동 다세대주택",
      position: { lat: 35.12754, lng: 126.9188 },
      type: "주택 화재 신고 (가상)",
      reportedAt: "18:07",
    },
    truckStart: { lat: 35.15194, lng: 126.90359 },
    truckRoute: [
      { to: { lat: 35.14505, lng: 126.91296 }, speedKmh: 25, label: "천변좌로 (양동~양림)", freeFlowKmh: 40 },
      { to: { lat: 35.13529, lng: 126.9218 }, speedKmh: 20, label: "천변좌로 퇴근길 서행 (양림)", congested: true, freeFlowKmh: 40 },
      { to: { lat: 35.13164, lng: 126.92494 }, speedKmh: 15, label: "천변좌로 방림 구간 퇴근길 상습정체", congested: true, hotspotId: "H-CB", freeFlowKmh: 40 },
      { to: { lat: 35.13077, lng: 126.9203 }, speedKmh: 20, label: "천변좌로566번길 · 방림터널", freeFlowKmh: 30 },
      { to: { lat: 35.12754, lng: 126.9188 }, speedKmh: 18, label: "용대로 → 현장", freeFlowKmh: 30 },
    ],
    // 혼잡 DB 에 없는 돌발 상황 — 선행 드론이 경로를 따라 정찰하다 발견 → 관제요원이 우회로 안내 여부 판단
    blockage: {
      kind: "accident",
      segIndex: 2,
      position: { lat: 35.13361, lng: 126.92344 },
      label: "천변좌로 추돌사고 — 차로 차단 (가상)",
      short: "사고 · 차로 차단",
      blockedSpeedKmh: 4,
      detour: {
        fromSeg: 2,
        via: [{ lat: 35.13404, lng: 126.91915 }],
        summary: "천변좌로에서 방림로로 우회전 → 방림삼거리 → 용대로 → 현장",
        segments: [
          { to: { lat: 35.13404, lng: 126.91915 }, speedKmh: 12, label: "방림로 (우회로)", freeFlowKmh: 30 },
          { to: { lat: 35.1304, lng: 126.918 }, speedKmh: 12, label: "용대로 (우회로)", freeFlowKmh: 30 },
          { to: { lat: 35.12754, lng: 126.9188 }, speedKmh: 10, label: "용대로 → 현장 (우회로)", freeFlowKmh: 30 },
        ],
      },
    },
    violations: [],
  },
};

/** 화면 순서: 시나리오 1(도로 막힘) → 시나리오 2(불법주차) */
export const SCENARIO_ORDER: ScenarioMode[] = ["regional", "urban"];
