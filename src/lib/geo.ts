// 결정적 공간 계산 모듈 — "판정은 코드" 원칙.
// 비행금지구역 회피 경로(A* + 시야 단축), 거리, ETA 를 모델이 아닌 코드로 계산한다.

import type { LatLng, NoFlyZone, RoadSegment, XY } from "../types/drone.ts";

/** 지도 범위 (전남·광주 경계 일대) */
export const BOUNDS = { latMax: 35.28, latMin: 35.0, lngMin: 126.68, lngMax: 127.05 };
const KM_PER_LAT = 111.0;
const KM_PER_LNG = 91.2; // 위도 35° 부근

export const MAP_KM = {
  w: (BOUNDS.lngMax - BOUNDS.lngMin) * KM_PER_LNG,
  h: (BOUNDS.latMax - BOUNDS.latMin) * KM_PER_LAT,
};

export function toXY(p: LatLng): XY {
  return { x: (p.lng - BOUNDS.lngMin) * KM_PER_LNG, y: (BOUNDS.latMax - p.lat) * KM_PER_LAT };
}

export function toLatLng(p: XY): LatLng {
  return { lat: BOUNDS.latMax - p.y / KM_PER_LAT, lng: BOUNDS.lngMin + p.x / KM_PER_LNG };
}

export function dist(a: XY, b: XY): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function distLatLng(a: LatLng, b: LatLng): number {
  return dist(toXY(a), toXY(b));
}

export function pointInPolygon(p: XY, poly: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function distPointSeg(p: XY, a: XY, b: XY): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function segmentsIntersect(p1: XY, p2: XY, p3: XY, p4: XY): boolean {
  const d = (a: XY, b: XY, c: XY) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = d(p3, p4, p1);
  const d2 = d(p3, p4, p2);
  const d3 = d(p1, p2, p3);
  const d4 = d(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 점이 폴리곤 내부이거나 margin(km) 이내인가 */
export function nearPolygon(p: XY, poly: XY[], margin: number): boolean {
  if (pointInPolygon(p, poly)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (distPointSeg(p, poly[j], poly[i]) < margin) return true;
  }
  return false;
}

/** 선분이 폴리곤을 관통/접촉하는가 */
export function segmentHitsPolygon(a: XY, b: XY, poly: XY[], margin = 0): boolean {
  if (nearPolygon(a, poly, margin) || nearPolygon(b, poly, margin)) return true;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (segmentsIntersect(a, b, poly[j], poly[i])) return true;
    if (margin > 0) {
      if (distPointSeg(poly[i], a, b) < margin) return true;
    }
  }
  // 촘촘한 샘플링으로 margin 보강
  if (margin > 0) {
    const n = Math.ceil(dist(a, b) / 0.1);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      if (nearPolygon({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, poly, margin)) return true;
    }
  }
  return false;
}

export interface FlightPlan {
  path: LatLng[];
  directKm: number;
  plannedKm: number;
  blockedBy: string[];
  avoided: boolean;
}

const SAFETY_MARGIN_KM = 0.35;
const GRID_KM = 0.25;

/**
 * 비행금지구역을 원천 배제한 최단 비행 경로.
 * 1) 직선이 금지구역과 겹치지 않으면 직선
 * 2) 겹치면 격자 A* → 시야(line-of-sight) 단축으로 꺾임점 최소화
 */
export function planFlight(from: LatLng, to: LatLng, zones: NoFlyZone[]): FlightPlan {
  const a = toXY(from);
  const b = toXY(to);
  const polys = zones.map((z) => ({ id: z.name, pts: z.polygon.map(toXY) }));
  const directKm = dist(a, b);
  const blockedBy = polys.filter((p) => segmentHitsPolygon(a, b, p.pts, SAFETY_MARGIN_KM)).map((p) => p.id);

  if (blockedBy.length === 0) {
    return { path: [from, to], directKm, plannedKm: directKm, blockedBy, avoided: false };
  }

  const cols = Math.ceil(MAP_KM.w / GRID_KM) + 1;
  const rows = Math.ceil(MAP_KM.h / GRID_KM) + 1;
  const blocked = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: c * GRID_KM, y: r * GRID_KM };
      if (polys.some((poly) => nearPolygon(p, poly.pts, SAFETY_MARGIN_KM + 0.05))) blocked[r * cols + c] = 1;
    }
  }
  const idx = (c: number, r: number) => r * cols + c;
  const sc = Math.round(a.x / GRID_KM);
  const sr = Math.round(a.y / GRID_KM);
  const gc = Math.round(b.x / GRID_KM);
  const gr = Math.round(b.y / GRID_KM);
  blocked[idx(sc, sr)] = 0;
  blocked[idx(gc, gr)] = 0;

  const g = new Float64Array(cols * rows).fill(Infinity);
  const came = new Int32Array(cols * rows).fill(-1);
  const closed = new Uint8Array(cols * rows);
  const h = (c: number, r: number) => Math.hypot(c - gc, r - gr);
  // 간단한 이진 힙
  const heap: [number, number][] = [];
  const push = (f: number, i: number) => {
    heap.push([f, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const pk = (k - 1) >> 1;
      if (heap[pk][0] <= heap[k][0]) break;
      [heap[pk], heap[k]] = [heap[k], heap[pk]];
      k = pk;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };

  const start = idx(sc, sr);
  const goal = idx(gc, gr);
  g[start] = 0;
  push(h(sc, sr), start);
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
    [1, 1], [1, -1], [-1, 1], [-1, -1],
  ];
  while (heap.length) {
    const [, cur] = pop();
    if (cur === goal) break;
    if (closed[cur]) continue;
    closed[cur] = 1;
    const cc = cur % cols;
    const cr = Math.floor(cur / cols);
    for (const [dc, dr] of dirs) {
      const nc = cc + dc;
      const nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = idx(nc, nr);
      if (blocked[ni] || closed[ni]) continue;
      const ng = g[cur] + Math.hypot(dc, dr);
      if (ng < g[ni]) {
        g[ni] = ng;
        came[ni] = cur;
        push(ng + h(nc, nr), ni);
      }
    }
  }

  if (came[goal] === -1) {
    // 경로 없음 — 직선 반환하되 표시
    return { path: [from, to], directKm, plannedKm: directKm, blockedBy, avoided: false };
  }

  const cells: XY[] = [];
  for (let cur = goal; cur !== -1; cur = came[cur]) {
    cells.push({ x: (cur % cols) * GRID_KM, y: Math.floor(cur / cols) * GRID_KM });
  }
  cells.reverse();
  cells[0] = a;
  cells[cells.length - 1] = b;

  // 시야 단축: 금지구역과 겹치지 않는 한 가장 먼 점으로 바로 연결
  const out: XY[] = [a];
  let i = 0;
  while (i < cells.length - 1) {
    let j = cells.length - 1;
    while (j > i + 1 && polys.some((p) => segmentHitsPolygon(cells[i], cells[j], p.pts, SAFETY_MARGIN_KM))) j--;
    out.push(cells[j]);
    i = j;
  }

  const plannedKm = out.slice(1).reduce((s, p, k) => s + dist(out[k], p), 0);
  return { path: out.map(toLatLng), directKm, plannedKm, blockedBy, avoided: true };
}

/** 경로가 어떤 금지구역과도 겹치지 않는지 검증 (테스트·도구용) */
export function validatePath(path: LatLng[], zones: NoFlyZone[]): { ok: boolean; violations: string[] } {
  const pts = path.map(toXY);
  const violations: string[] = [];
  for (const z of zones) {
    const poly = z.polygon.map(toXY);
    for (let k = 1; k < pts.length; k++) {
      if (segmentHitsPolygon(pts[k - 1], pts[k], poly, 0)) {
        violations.push(z.name);
        break;
      }
    }
  }
  return { ok: violations.length === 0, violations };
}

export function pathLengthKm(path: LatLng[]): number {
  let s = 0;
  for (let k = 1; k < path.length; k++) s += distLatLng(path[k - 1], path[k]);
  return s;
}

/** 경로 위에서 진행 거리(km)에 해당하는 위치 */
export function pointAlong(path: LatLng[], km: number): LatLng {
  let remain = km;
  for (let k = 1; k < path.length; k++) {
    const seg = distLatLng(path[k - 1], path[k]);
    if (remain <= seg) {
      const t = seg === 0 ? 0 : remain / seg;
      return {
        lat: path[k - 1].lat + (path[k].lat - path[k - 1].lat) * t,
        lng: path[k - 1].lng + (path[k].lng - path[k - 1].lng) * t,
      };
    }
    remain -= seg;
  }
  return path[path.length - 1];
}

/** 도로 구간별 속도로 소방차 위치/진행률 계산 */
export interface TruckTimeline {
  points: LatLng[];
  /** 각 꼭짓점 도달 시각(초) */
  times: number[];
  totalSec: number;
  totalKm: number;
}

/** 직선 대비 실제 도로 굴곡 보정 계수 */
export const ROAD_FACTOR = 1.18;

export function buildTruckTimeline(start: LatLng, segs: RoadSegment[]): TruckTimeline {
  const points = [start];
  const times = [0];
  let t = 0;
  let km = 0;
  let prev = start;
  for (const s of segs) {
    const d = distLatLng(prev, s.to) * ROAD_FACTOR;
    t += (d / s.speedKmh) * 3600;
    km += d;
    points.push(s.to);
    times.push(t);
    prev = s.to;
  }
  return { points, times, totalSec: t, totalKm: km };
}

export function truckAt(tl: TruckTimeline, sec: number): { pos: LatLng; segIndex: number; progress: number } {
  if (sec <= 0) return { pos: tl.points[0], segIndex: 0, progress: 0 };
  if (sec >= tl.totalSec) return { pos: tl.points[tl.points.length - 1], segIndex: tl.points.length - 2, progress: 1 };
  for (let k = 1; k < tl.times.length; k++) {
    if (sec <= tl.times[k]) {
      const t = (sec - tl.times[k - 1]) / (tl.times[k] - tl.times[k - 1]);
      const a = tl.points[k - 1];
      const b = tl.points[k];
      return {
        pos: { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t },
        segIndex: k - 1,
        progress: sec / tl.totalSec,
      };
    }
  }
  return { pos: tl.points[tl.points.length - 1], segIndex: tl.points.length - 2, progress: 1 };
}

/** 경로 진행률(0~1, 거리 기준)에 해당하는 소방차 경로상 지점 */
export function pointOnTruckRoute(tl: TruckTimeline, ratio: number): LatLng {
  return pointAlong(tl.points, pathLengthKm(tl.points) * ratio);
}

/** 순항 54km/h(15m/s) — 도크 운용 기체(DJI Dock 3 + Matrice 4D, 원격 조종)는 Normal 모드만 지원, 상한 15m/s */
export const DRONE_SPEED_KMH = 54;

/** 간선도로 소통 등급 (서울시·국토부 기준: ≤15 정체, 15~25 서행, ≥25 원활) */
export type SpeedClass = "정체" | "서행" | "원활";
export function speedClass(kmh: number): SpeedClass {
  if (kmh <= 15) return "정체";
  if (kmh < 25) return "서행";
  return "원활";
}

/** 경로가 원(관제권 등) 안을 지나는가 */
export function pathEntersCircle(path: LatLng[], center: LatLng, radiusKm: number): boolean {
  for (let k = 1; k < path.length; k++) {
    const n = Math.max(2, Math.ceil(distLatLng(path[k - 1], path[k]) / 0.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = { lat: path[k - 1].lat + (path[k].lat - path[k - 1].lat) * t, lng: path[k - 1].lng + (path[k].lng - path[k - 1].lng) * t };
      if (distLatLng(p, center) <= radiusKm) return true;
    }
  }
  return false;
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function formatLatLng(p: LatLng): string {
  return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
}

/** 관할 지자체 개략 매핑 (시연용 바운딩박스, 실제 행정경계 아님)
 *  전남광주통합특별시(2026-07-01 출범)는 기존 시·군·구 명칭과 관할구역을 유지하고 광역 명칭만 바뀜.
 *  code: 시군구 행정구역 코드 — 옛 광주 29xxx / 옛 전남 46xxx (통합 후 코드 변경 여부는 확인 필요) */
export const CITY = "전남광주통합특별시";

export interface Jurisdiction {
  /** 공식 표기 예: 전남광주통합특별시 남구 */
  name: string;
  /** 좁은 화면용 예: 남구 */
  short: string;
  /** 예: 전남광주통합특별시 남구청 교통과 */
  agency: string;
  code: string;
  former: "옛 광주" | "옛 전남";
}

export function mapJurisdiction(p: LatLng): Jurisdiction {
  const { lat, lng } = p;
  const r = (short: string, office: string, dept: string, code: string): Jurisdiction => ({
    name: `${CITY} ${short}`,
    short,
    agency: `${CITY} ${office} ${dept}`,
    code,
    former: code.startsWith("29") ? "옛 광주" : "옛 전남",
  });
  if (lat >= 35.24 && lng < 126.85) return r("장성군", "장성군청", "교통행정과", "46880");
  if (lat >= 35.24 && lng >= 126.93) return r("담양군", "담양군청", "건설교통과", "46710");
  if (lat < 35.07 && lng < 126.9) return r("나주시", "나주시청", "교통행정과", "46170");
  if (lng >= 126.94 && lat < 35.12) return r("화순군", "화순군청", "건설교통과", "46790");
  if (lng < 126.84) return r("광산구", "광산구청", "교통지도과", "29200");
  if (lat >= 35.165) return r("북구", "북구청", "교통행정과", "29170");
  if (lng >= 126.91 && lat >= 35.12) return r("동구", "동구청", "교통과", "29110");
  if (lat < 35.135 && lng >= 126.84) return r("남구", "남구청", "교통과", "29155");
  return r("서구", "서구청", "교통과", "29140");
}
