// 1단계 시범 규모 드론 거점 (가정: 소방서 6곳에 도크 설치, 거점당 3대 = 18대). 위치·대수는 모두 가상입니다.
// 드론은 출동하는 소방서의 도크에서 소방차와 같은 곳에서 출발한다(배차 규칙은 dispatch.ts).
// 비행 제한 구역(관제권 등) 반영은 추후 보완.
// 로드맵: 1단계 시범 → 2단계 성과·예산에 따라 거점 확대 → 3단계 광역 통합 풀(목표 200대는 가정, 공식 출처 없음)
import type { DroneBase } from "../types/drone.ts";

export const DRONE_BASES: DroneBase[] = [
  { id: "B-NS", name: "서부소방서 농성119안전센터 (가상 위치)", position: { lat: 35.15272, lng: 126.88119 }, capacity: 3 },
  { id: "B-DB", name: "동부소방서 (가상 위치)", position: { lat: 35.146, lng: 126.93 }, capacity: 3 },
  { id: "B-BB", name: "북부소방서 (가상 위치)", position: { lat: 35.205, lng: 126.895 }, capacity: 3 },
  { id: "B-DC", name: "남부소방서 대촌119안전센터 (가상 위치)", position: { lat: 35.07135, lng: 126.84483 }, capacity: 3 },
  { id: "B-HS", name: "화순소방서 (가상 위치)", position: { lat: 35.0612, lng: 126.9862 }, capacity: 3 },
  { id: "B-DY", name: "담양소방서 (가상 위치)", position: { lat: 35.27, lng: 126.99 }, capacity: 3 },
];

export const DRONE_POOL_TOTAL = DRONE_BASES.reduce((s, b) => s + b.capacity, 0); // 18
/** 3단계 광역 통합 목표 (가정 — 공식 출처 없음) */
export const STAGE3_TARGET = 200;
