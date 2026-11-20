// 실제 도로 선(ROAD_GEOMETRY) 위에서 거리·위치를 계산하는 공용 도구.
// 시뮬레이션(도착 시간), 투입 판단(예상 지연), 지도·소방차 화면(위치·남은 거리)이 모두 같은 도로 거리를 쓴다.
// 우회로를 안내하면 기존 경로의 일부를 우회 도로(DETOUR_GEOMETRY)로 바꾼 경로를 만든다 (구간 수는 같음).

import { DETOUR_GEOMETRY, ROAD_GEOMETRY } from "../data/roadGeometry.ts";
import type { LatLng, RoadSegment, Scenario } from "../types/drone.ts";
import { distLatLng } from "./geo.ts";

export type Pt = [number, number];
export type RouteVariant = "base" | "detour";
const dKm = (a: Pt, b: Pt) => distLatLng({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });
export const toLatLng = (p: Pt): LatLng => ({ lat: p[0], lng: p[1] });

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
  /** 구간 경계의 도로 선 인덱스 */
  idx: number[];
  /** 구간별 실제 도로 거리(km) */
  segKm: number[];
}

export interface ScenarioRoute {
  variant: RouteVariant;
  segs: RoadSegment[];
  road: ScenarioRoad;
}

function mapRoad(line: Pt[], km: number, verts: LatLng[]): ScenarioRoad {
  const tools = roadTools(line, km);
  const fr = [0];
  const idx = [0];
  let i = 0;
  for (let v = 1; v < verts.length - 1; v++) {
    const n = tools.nearest([verts[v].lat, verts[v].lng], i);
    i = n.idx;
    fr.push(Math.max(fr[fr.length - 1], n.f));
    idx.push(n.idx);
  }
  fr.push(1);
  idx.push(line.length - 1);
  const segKm = fr.slice(1).map((f, k) => (f - fr[k]) * tools.km);
  return { line, tools, fr, idx, segKm };
}

const cache = new Map<string, ScenarioRoute>();

/** 시나리오 경로(기존 또는 우회)를 실제 도로 선에 대응시켜 구간별 도로 거리를 구한다 */
export function scenarioRoute(sc: Scenario, variant: RouteVariant = "base"): ScenarioRoute {
  const detour = sc.blockage?.detour;
  const dg = DETOUR_GEOMETRY[sc.mode];
  const v: RouteVariant = variant === "detour" && detour && dg ? "detour" : "base";
  const key = `${sc.mode}:${v}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const g = ROAD_GEOMETRY[sc.mode];
  const base = mapRoad(g.line, g.distanceM / 1000, [sc.truckStart, ...sc.truckRoute.map((s) => s.to)]);
  let route: ScenarioRoute = { variant: "base", segs: sc.truckRoute, road: base };
  if (v === "detour" && detour && dg) {
    const from = detour.fromSeg;
    const rejoin = from + detour.segments.length; // 다시 합류하는 기존 꼭짓점
    const line: Pt[] = [...g.line.slice(0, base.idx[from] + 1), ...dg.line, ...g.line.slice(base.idx[rejoin] + 1)];
    const baseKm = base.tools.km;
    const km = base.fr[from] * baseKm + dg.distanceM / 1000 + (1 - base.fr[rejoin]) * baseKm;
    const segs = [...sc.truckRoute.slice(0, from), ...detour.segments, ...sc.truckRoute.slice(rejoin)];
    route = { variant: "detour", segs, road: mapRoad(line, km, [sc.truckStart, ...segs.map((s) => s.to)]) };
  }
  cache.set(key, route);
  return route;
}

/** 기존 경로의 도로 대응 (투입 판단 등) */
export function scenarioRoad(sc: Scenario): ScenarioRoad {
  return scenarioRoute(sc, "base").road;
}
