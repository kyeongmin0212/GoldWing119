// 전남·광주 광역 출동 시나리오 (시연용 가상 데이터)
// 지명·좌표는 공개 지도 기준 개략값, 구간 속도는 가정값, 차량번호·신고 내용은 모두 가상입니다.
// 번호판 형식: 국토교통부 「자동차 등록번호판 등의 기준에 관한 고시」 차종 분류기호(승합 70~79, 화물 80~97/800~979)

import type { Scenario, ScenarioMode } from "../types/drone.ts";

export const SCENARIOS: Record<ScenarioMode, Scenario> = {
  urban: {
    mode: "urban",
    title: "시나리오 2 · 불법주차로 진입 곤란 → 다른 경로 안내 + 통보 초안 — 남구 봉선동 공동주택 화재 (출근길)",
    description: "백운광장 상습정체 + 현장 진입로(봉선2로) 불법주차 2대로 소방차 진입 곤란",
    focus: "드론이 진입로 불법주차를 발견 → 다른 진입 경로 안내, 주차 차량은 지자체 통보 초안",
    station: { name: "서부소방서 상무 (가상 위치)", position: { lat: 35.1523, lng: 126.8525 } },
    incident: {
      name: "남구 봉선동 공동주택",
      position: { lat: 35.1265, lng: 126.91 },
      type: "공동주택 화재 신고 (가상)",
      reportedAt: "08:12",
    },
    truckStart: { lat: 35.1523, lng: 126.8525 },
    truckRoute: [
      { to: { lat: 35.15272, lng: 126.88119 }, speedKmh: 22, label: "상무대로 출근길 서행", congested: true, freeFlowKmh: 50 },
      { to: { lat: 35.13359, lng: 126.89478 }, speedKmh: 30, label: "군분로", freeFlowKmh: 45 },
      { to: { lat: 35.13473, lng: 126.89899 }, speedKmh: 12, label: "백운광장 교차로 상습정체 (회재로)", congested: true, hotspotId: "H-BU", freeFlowKmh: 40 },
      { to: { lat: 35.12535, lng: 126.90631 }, speedKmh: 18, label: "봉선로 출근길 서행", congested: true, freeFlowKmh: 40 },
      { to: { lat: 35.1265, lng: 126.91 }, speedKmh: 8, label: "봉선2로 · 현장 진입로 (불법주정차 다발)", congested: true, hotspotId: "H-BS", freeFlowKmh: 25 },
    ],
    // 드론이 정찰하다 발견 → 관제요원이 다른 진입 경로 안내 여부 판단, 주차 차량은 통보 초안
    blockage: {
      kind: "parking",
      segIndex: 4,
      position: { lat: 35.125445, lng: 126.90693 },
      label: "봉선2로 불법주차 2대 — 소방차 진입 곤란 (가상)",
      short: "불법주차 · 진입 곤란",
      blockedSpeedKmh: 3,
      detour: {
        fromSeg: 4,
        via: [{ lat: 35.124, lng: 126.9095 }],
        summary: "봉선로 직진 → 봉선로133번길 → 봉선로121번길 → 봉선2로19번길로 현장 진입",
        segments: [{ to: { lat: 35.1265, lng: 126.91 }, speedKmh: 15, label: "봉선로133번길·121번길 → 봉선2로19번길 (다른 진입 경로)", congested: true, freeFlowKmh: 25 }],
      },
    },
    violations: [
      {
        id: "V-U1",
        plate: "12가 3456",
        vehicleType: "승용차 (흰색 SUV)",
        reason: "긴급차량 진로 방해 / 소화전 5m 이내 주정차",
        position: { lat: 35.12544, lng: 126.90688 },
        locationLabel: "전남광주통합특별시 남구 봉선동 봉선2로 현장 진입로 (가상 지점)",
        confidence: 0.94,
      },
      {
        id: "V-U2",
        plate: "75나 7712",
        vehicleType: "승합차 (회색)",
        reason: "소방자동차 전용구역 주차 (공동주택 진입로)",
        position: { lat: 35.12545, lng: 126.90698 },
        locationLabel: "전남광주통합특별시 남구 봉선동 공동주택 진입로 (가상 지점)",
        confidence: 0.88,
      },
    ],
  },
  regional: {
    mode: "regional",
    title: "시나리오 1 · 도로 막힘 → 더 빠른 길 안내 — 나주 빛가람 → 남구 효천지구 화재 (퇴근길)",
    description: "국도1호선 광주 진입 병목, 드론이 앞서 정찰하다 서문대로 사고로 길이 막힌 것을 발견",
    focus: "처음 안내한 길 대신 더 빠른 길(포충로·임암길)로 소방차 안내",
    station: { name: "나주소방서 빛가람센터 (가상 위치)", position: { lat: 35.02, lng: 126.792 } },
    incident: {
      name: "남구 효천지구 상가주택",
      position: { lat: 35.096, lng: 126.87 },
      type: "상가주택 화재 신고 (가상)",
      reportedAt: "18:07",
    },
    truckStart: { lat: 35.02, lng: 126.792 },
    truckRoute: [
      { to: { lat: 35.03983, lng: 126.79324 }, speedKmh: 35, label: "혁신도시 내부도로 (우정로·혁신로)" },
      { to: { lat: 35.05667, lng: 126.84043 }, speedKmh: 45, label: "영산로 (국도 1호선)", freeFlowKmh: 70 },
      { to: { lat: 35.07136, lng: 126.84483 }, speedKmh: 14, label: "광주 진입 병목 (영산로, 옛 나주-광주 경계)", congested: true, hotspotId: "H-NG", freeFlowKmh: 60 },
      { to: { lat: 35.0829, lng: 126.86718 }, speedKmh: 24, label: "서문대로 퇴근길 서행", congested: true },
      { to: { lat: 35.09834, lng: 126.8774 }, speedKmh: 24, label: "서문대로 (효천 방면)", congested: true },
      { to: { lat: 35.10009, lng: 126.86539 }, speedKmh: 12, label: "효천로·임암길 이면도로", congested: true, freeFlowKmh: 30 },
      { to: { lat: 35.09592, lng: 126.86979 }, speedKmh: 8, label: "효천지구 현장 진입로", congested: true, freeFlowKmh: 25 },
    ],
    // 혼잡 DB 에 없는 돌발 상황 — 선행 드론이 경로를 따라 정찰하다 발견 → 관제요원이 우회로 안내 여부 판단
    blockage: {
      kind: "accident",
      segIndex: 4,
      position: { lat: 35.08675, lng: 126.8759 },
      label: "서문대로 추돌사고 — 2개 차로 차단 (가상)",
      short: "사고 · 차로 차단",
      blockedSpeedKmh: 10,
      detour: {
        fromSeg: 4,
        summary: "서문대로 포충로 교차로에서 우측 진출 → 포충로 → 임암길 → 효천지구",
        segments: [
          { to: { lat: 35.09067, lng: 126.85294 }, speedKmh: 35, label: "포충로 (우회로)", freeFlowKmh: 50 },
          { to: { lat: 35.10009, lng: 126.86539 }, speedKmh: 15, label: "임암길 (우회로, 이면도로)", congested: true, freeFlowKmh: 30 },
        ],
      },
    },
    violations: [],
  },
};

/** 화면 순서: 시나리오 1(도로 막힘) → 시나리오 2(불법주차) */
export const SCENARIO_ORDER: ScenarioMode[] = ["regional", "urban"];
