// 실제 도로 선(ROAD_GEOMETRY) 위에서 거리·위치를 계산하는 공용 도구.
// 시뮬레이션(도착 시간), 투입 판단(예상 지연), 지도·소방차 화면(위치·남은 거리)이 모두 같은 도로 거리를 쓴다.

import { ROAD_GEOMETRY } from "../data/roadGeometry.ts";
import type { LatLng, Scenario, ScenarioMode } from "../types/drone.ts";
import { distLatLng } from "./geo.ts";

export type Pt = [number, number];
const dKm = (a: Pt, b: Pt) => distLatLng({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

export function roadTools(line: Pt[], realKm?: number) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dKm(line[i - 1], line[i]));
  const total = cum[cum.length - 1] || 1;
  /** 도로 실제 길이(km) — OSRM 도로 거리, 없으면 선 길이 */
  const km = realKm ?? total;
  const at = (f: number): Pt => {
    const d = Math.max(0, Math.min(1, f)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / seg;
    return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
  };
  const sub = (f1: number, f2: number): Pt[] => {
    const a = Math.max(0, f1) * total;
    const b = Math.min(1, f2) * total;
    const out: Pt[] = [at(f1)];
    for (let i = 0; i < line.length; i++) if (cum[i] > a && cum[i] < b) out.push(line[i]);
    out.push(at(f2));
    return out;
  };
  /** 점에서 가장 가까운 선 위 위치(비율). from 이후 인덱스에서만 찾아 순서를 지킨다 */
  const nearest = (p: Pt, from = 0): { f: number; idx: number; pt: Pt } => {
    let best = from;
    for (let i = from; i < line.length; i++) if (dKm(line[i], p) < dKm(line[best], p)) best = i;
    return { f: cum[best] / total, idx: best, pt: line[best] };
  };
  return { at, sub, nearest, km };
}

export interface ScenarioRoad {
  line: Pt[];
  tools: ReturnType<typeof roadTools>;
  /** 구간 경계(출발·경유점·현장)의 도로 위 비율 — 길이 = 구간 수 + 1 */
  fr: number[];
  /** 구간별 실제 도로 거리(km) */
  segKm: number[];
}

const cache = new Map<ScenarioMode, ScenarioRoad>();

/** 시나리오 구간들을 실제 도로 선에 대응시켜 구간별 도로 거리를 구한다 */
export function scenarioRoad(sc: Scenario): ScenarioRoad {
  const hit = cache.get(sc.mode);
  if (hit) return hit;
  const g = ROAD_GEOMETRY[sc.mode];
  const line = g.line;
  const tools = roadTools(line, g.distanceM / 1000);
  const verts: LatLng[] = [sc.truckStart, ...sc.truckRoute.map((s) => s.to)];
  const fr: number[] = [0];
  let idx = 0;
  for (let v = 1; v < verts.length - 1; v++) {
    const n = tools.nearest([verts[v].lat, verts[v].lng], idx);
    idx = n.idx;
    fr.push(Math.max(fr[fr.length - 1], n.f));
  }
  fr.push(1);
  const segKm = sc.truckRoute.map((_, k) => (fr[k + 1] - fr[k]) * tools.km);
  const road = { line, tools, fr, segKm };
  cache.set(sc.mode, road);
  return road;
}
