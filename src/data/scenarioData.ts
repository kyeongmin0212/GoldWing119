// 전남·광주 광역 출동 시나리오 (시연용 가상 데이터)
// 지명·좌표는 공개 지도 기준 개략값, 구간 속도는 가정값, 차량번호·신고 내용은 모두 가상입니다.
// 번호판 형식: 국토교통부 「자동차 등록번호판 등의 기준에 관한 고시」 차종 분류기호(승합 70~79, 화물 80~97/800~979)

import type { Scenario, ScenarioMode } from "../types/drone.ts";

export const SCENARIOS: Record<ScenarioMode, Scenario> = {
  urban: {
    mode: "urban",
    title: "광주 도심형 · 출근길 — 남구 봉선동 공동주택 화재",
    description: "출근 시간대 백운광장 상습정체 + 봉선동 이면도로 불법주정차 다발 구간",
    focus: "골목길 불법주정차 단속 집중",
    station: { name: "광산소방서 (가상 위치)", position: { lat: 35.139, lng: 126.79 } },
    incident: {
      name: "남구 봉선동 공동주택",
      position: { lat: 35.1265, lng: 126.91 },
      type: "공동주택 화재 신고 (가상)",
      reportedAt: "08:12",
    },
    truckStart: { lat: 35.139, lng: 126.79 },
    truckRoute: [
      { to: { lat: 35.143, lng: 126.816 }, speedKmh: 48, label: "송정로" },
      { to: { lat: 35.15, lng: 126.842 }, speedKmh: 22, label: "상무대로 출근길 서행", congested: true },
      { to: { lat: 35.148, lng: 126.86 }, speedKmh: 20, label: "상무지구 교차로 신호 대기", congested: true },
      { to: { lat: 35.138, lng: 126.88 }, speedKmh: 45, label: "대남대로" },
      { to: { lat: 35.133, lng: 126.896 }, speedKmh: 14, label: "백운광장 교차로 상습정체", congested: true, hotspotId: "H-BU" },
      { to: { lat: 35.129, lng: 126.905 }, speedKmh: 10, label: "봉선동 이면도로 (불법주정차 다발)", congested: true, hotspotId: "H-BS", freeFlowKmh: 30 },
      { to: { lat: 35.1265, lng: 126.91 }, speedKmh: 8, label: "현장 진입로", congested: true, hotspotId: "H-BS", freeFlowKmh: 25 },
    ],
    violations: [
      {
        id: "V-U1",
        plate: "12가 3456",
        vehicleType: "승용차 (흰색 SUV)",
        reason: "긴급차량 진로 방해 / 소화전 5m 이내 주정차",
        position: { lat: 35.1302, lng: 126.9027 },
        locationLabel: "전남광주통합특별시 남구 봉선동 이면도로 (가상 지점)",
        confidence: 0.94,
      },
      {
        id: "V-U2",
        plate: "75나 7712",
        vehicleType: "승합차 (회색)",
        reason: "소방자동차 전용구역 주차 (공동주택 진입로)",
        position: { lat: 35.1276, lng: 126.9078 },
        locationLabel: "전남광주통합특별시 남구 봉선동 공동주택 진입로 (가상 지점)",
        confidence: 0.88,
      },
    ],
  },
  regional: {
    mode: "regional",
    title: "전남-광주 광역형 · 퇴근길 — 나주시 → 남구 효천지구 화재 (옛 시도 경계)",
    description: "나주 혁신도시 출동, 국도1호선 광주 진입 병목 + 효천지구 이면도로 불법주정차",
    focus: "장거리 정체 구간 길터주기 유도 + 경계 지역 단속",
    station: { name: "나주소방서 빛가람센터 (가상 위치)", position: { lat: 35.02, lng: 126.792 } },
    incident: {
      name: "남구 효천지구 상가주택",
      position: { lat: 35.096, lng: 126.87 },
      type: "상가주택 화재 신고 (가상)",
      reportedAt: "18:07",
    },
    truckStart: { lat: 35.02, lng: 126.792 },
    truckRoute: [
      { to: { lat: 35.035, lng: 126.805 }, speedKmh: 40, label: "혁신도시 내부도로" },
      { to: { lat: 35.055, lng: 126.825 }, speedKmh: 30, label: "국도 1호선 (퇴근 차량 합류)", freeFlowKmh: 70 },
      { to: { lat: 35.07, lng: 126.84 }, speedKmh: 14, label: "광주 진입 병목 (나주-광주 경계)", congested: true, hotspotId: "H-NG", freeFlowKmh: 60 },
      { to: { lat: 35.085, lng: 126.855 }, speedKmh: 22, label: "효천로 퇴근길 서행", congested: true },
      { to: { lat: 35.092, lng: 126.865 }, speedKmh: 12, label: "효천지구 이면도로 (불법주정차 다발)", congested: true, hotspotId: "H-HC", freeFlowKmh: 30 },
      { to: { lat: 35.096, lng: 126.87 }, speedKmh: 8, label: "현장 진입로", congested: true, hotspotId: "H-HC", freeFlowKmh: 25 },
    ],
    violations: [
      {
        id: "V-R1",
        plate: "812다 4518",
        vehicleType: "화물차 (1톤 트럭)",
        reason: "긴급차량 진로 방해 / 교차로 모퉁이 5m 이내 정차",
        position: { lat: 35.0899, lng: 126.8617 },
        locationLabel: "전남광주통합특별시 남구 효천지구 이면도로 (옛 광주·전남 경계 인근, 가상 지점)",
        confidence: 0.91,
      },
      {
        id: "V-R2",
        plate: "57라 2093",
        vehicleType: "승용차 (검정 세단)",
        reason: "소화전 5m 이내 주정차",
        position: { lat: 35.0945, lng: 126.8678 },
        locationLabel: "전남광주통합특별시 남구 효천지구 상가 앞 (가상 지점)",
        confidence: 0.86,
      },
    ],
  },
  night: {
    mode: "night",
    title: "야간 · 한산 도로 — 광산구 하남산업단지 공장 화재",
    description: "새벽 시간 간선도로 소통 원활, 경로상 혼잡 DB 지점 없음",
    focus: "드론 투입 불필요 판단 (소방차 단독 출동)",
    station: { name: "광산소방서 (가상 위치)", position: { lat: 35.139, lng: 126.79 } },
    incident: {
      name: "광산구 하남산업단지 공장",
      position: { lat: 35.193, lng: 126.806 },
      type: "공장 화재 신고 (가상)",
      reportedAt: "02:40",
    },
    truckStart: { lat: 35.139, lng: 126.79 },
    truckRoute: [
      { to: { lat: 35.16, lng: 126.792 }, speedKmh: 55, label: "어등대로 (원활)" },
      { to: { lat: 35.18, lng: 126.8 }, speedKmh: 58, label: "하남대로 (원활)" },
      { to: { lat: 35.193, lng: 126.806 }, speedKmh: 40, label: "산단 진입로" },
    ],
    violations: [],
  },
};

export const SCENARIO_ORDER: ScenarioMode[] = ["urban", "regional", "night"];
