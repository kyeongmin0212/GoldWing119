// 1단계 시범 규모 드론 거점 (가상: 6개 거점 × 3대 = 18대). 위치·대수는 모두 가상입니다.
// 로드맵: 1단계 시범 → 2단계 성과·예산에 따라 거점 확대 → 3단계 광역 통합 풀(목표 200대는 가정, 공식 출처 없음)
import type { DroneBase } from "../types/drone.ts";

export const DRONE_BASES: DroneBase[] = [
  { id: "B-SJ", name: "광산 송정 거점", position: { lat: 35.142, lng: 126.769 }, capacity: 3 },
  { id: "B-CD", name: "광산 첨단 거점", position: { lat: 35.235, lng: 126.845 }, capacity: 3 },
  { id: "B-BG", name: "나주 빛가람 거점", position: { lat: 35.02, lng: 126.79 }, capacity: 3 },
  { id: "B-HS", name: "화순 거점", position: { lat: 35.065, lng: 126.99 }, capacity: 3 },
  { id: "B-DY", name: "담양 거점", position: { lat: 35.27, lng: 126.99 }, capacity: 3 },
  { id: "B-JS", name: "장성 거점", position: { lat: 35.27, lng: 126.78 }, capacity: 3 },
];

export const DRONE_POOL_TOTAL = DRONE_BASES.reduce((s, b) => s + b.capacity, 0); // 18
/** 3단계 광역 통합 목표 (가정 — 공식 출처 없음) */
export const STAGE3_TARGET = 200;
