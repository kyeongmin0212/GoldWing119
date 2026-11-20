// 시나리오 + 투입 결정 (+ 경로 판단) → 시뮬레이션 계획(소방차·드론 타임라인, 탐지 시각, 전방 차단). 순수 함수.
// 드론은 자기 길로 날지 않는다: 거점에서 소방차 경로의 정찰 구간 입구로 간 뒤 소방차가 갈 실제 도로를 따라 앞서 비행한다.
// 정찰 드론이 전방 차단을 발견하면 관제요원이 우회로 안내 여부를 정하고(routeChoice), 소방차 경로가 바뀐다.
// 비행 제한 구역(관제권·회피구역) 반영은 추후 보완 — 지금은 거점 → 합류 지점 직선.

import type { DispatchDecision, DroneAssignment, LatLng, RouteChoice, Scenario } from "../types/drone.ts";
import { scenarioRoute, toLatLng, type ScenarioRoute } from "./road.ts";
import { DRONE_SPEED_KMH, buildTruckTimeline, distLatLng, planFlight, truckAt, type FlightPlan, type TruckTimeline } from "./geo.ts";

export const SCAN_SPEED_KMH = 28; // 혼잡 구간 저속 정찰·방송 비행
export const LAUNCH_PREP_SEC = 25; // 이륙 준비 (원격 조종자가 도크에서 이륙시키는 데 20~30초)
/** 길터주기 방송은 소방차 도착 이 시간 전부터 (그 전에는 탐지·신고에 집중) */
export const BROADCAST_BEFORE_SEC = 180;
/** 목표 선행 시간 — 소방차보다 이만큼 먼저 정찰 구간에 도착하도록 이륙 시각을 맞춘다(체공 배터리 절약) */
export const TARGET_LEAD_SEC = 240;

export interface DroneSim {
  assignment: DroneAssignment;
  flight: FlightPlan;
  points: LatLng[];
  times: number[];
  totalSec: number;
  /** 이륙 준비 시작 시각 (즉시 이륙이면 0) */
  launchSec: number;
  /** 실제로 날기 시작하는 시각 — 출동 소방서 드론은 소방차와 동시에 출발(준비 시간 없음) */
  takeoffSec: number;
  /** 정찰(방송) 구간 도착 시각 */
  scanStartSec: number;
  /** 길터주기 LED·음성 방송 시작 시각 */
  broadcastSec: number;
  /** 소방차가 같은 지점에 도착하는 시각 */
  truckEntrySec: number;
  leadSec: number;
  /** 정찰 구간을 지나 소방차 경로를 따라 전방 선행 정찰을 시작하는 시각 (정찰 드론만) */
  aheadSec?: number;
}

export interface BlockageInfo {
  /** roadwork: 도로 공사로 차로 통제 / parking: 불법주차로 진입 곤란 */
  kind: "roadwork" | "parking";
  /** 지도·영상 표식용 짧은 이름 */
  short: string;
  droneId: string;
  /** 정찰 드론이 차단 지점에 도착해 발견하는 시각 */
  atSec: number;
  /** 소방차가 갈림길에 닿는 시각 — 이 전에 판단해야 우회 가능 */
  decideBySec: number;
  position: LatLng;
  label: string;
  summary: string;
  /** 기존 경로 유지 / 우회 시 현장 도착 시각 */
  stayArrivalSec: number;
  detourArrivalSec: number;
  savedSec: number;
}

export interface SimPlan {
  route: ScenarioRoute;
  truck: TruckTimeline;
  drones: DroneSim[];
  detections: { violationId: string; droneId: string; atSec: number }[];
  blockage: BlockageInfo | null;
  endSec: number;
}

function timeline(points: LatLng[], speeds: number[], startSec: number): number[] {
  const times = [startSec];
  let t = startSec;
  for (let k = 1; k < points.length; k++) {
    t += (distLatLng(points[k - 1], points[k]) / speeds[k - 1]) * 3600;
    times.push(t);
  }
  return times;
}

/** 이어 붙이기: 마지막 점에서 pts 를 speed 로 비행 */
function extend(points: LatLng[], times: number[], pts: LatLng[], speed: number): void {
  const t = timeline([points[points.length - 1], ...pts], pts.map(() => speed), times[times.length - 1]);
  points.push(...pts);
  times.push(...t.slice(1));
}

export function droneAt(d: Pick<DroneSim, "points" | "times" | "totalSec">, sec: number): LatLng {
  if (sec <= d.times[0]) return d.points[0];
  return truckAt({ points: d.points, times: d.times, totalSec: d.totalSec, totalKm: 0 }, sec).pos;
}

/** 경로·소방차 시간표 만들기. blocked = 전방 차단이 실제로 소방차를 막는 경우(그대로 지나감) */
function routeAndTruck(sc: Scenario, variant: "base" | "detour", blocked: boolean): { route: ScenarioRoute; truck: TruckTimeline } {
  const r = scenarioRoute(sc, variant);
  const bl = sc.blockage;
  const segs =
    blocked && bl && r.variant === "base"
      ? r.segs.map((s, i) => (i === bl.segIndex ? { ...s, speedKmh: bl.blockedSpeedKmh, label: `${s.label} — ${bl.label}`, congested: true } : s))
      : r.segs;
  const route = { ...r, segs };
  return { route, truck: buildTruckTimeline(sc.truckStart, segs, r.road.segKm) };
}

/** 드론 한 대: 거점 → 정찰 구간 입구(직선) → 소방차가 갈 실제 도로를 따라 정찰 */
function planDrone(a: DroneAssignment, route: ScenarioRoute, truck: TruckTimeline, minLaunch = 0): DroneSim {
  const { road } = route;
  const first = a.cluster.firstSeg;
  const lastVertex = a.cluster.lastSeg + 1 >= truck.points.length - 2 ? truck.points.length - 1 : a.cluster.lastSeg + 1;
  const scanPts = road.tools.sub(road.fr[first], road.fr[lastVertex]).map(toLatLng);
  const entry = scanPts[0];
  // 출동 소방서 드론(거점 = 소방차 출발지)은 소방차가 갈 도로를 따라 앞서 비행해 정찰 구간에 들어간다.
  // 다른 소방서에서 오는 드론은 거점 → 정찰 구간 입구 직선.
  const fromStation = distLatLng(a.base.position, truck.points[0]) < 0.5;
  const flight: FlightPlan = fromStation
    ? (() => {
        // 소방차 출발점(소방서 앞 도로)에서 이륙해 소방차가 갈 도로를 따라 난다 (도로에서 30m 안쪽으로 단순화)
        const path = simplify(road.tools.sub(0, road.fr[first]).map(toLatLng), 0.03);
        let km = 0;
        for (let i = 1; i < path.length; i++) km += distLatLng(path[i - 1], path[i]);
        return { path, directKm: distLatLng(a.base.position, entry), plannedKm: km, blockedBy: [], avoided: false };
      })()
    : planFlight(a.base.position, entry, []);
  const truckEntrySec = truck.times[first];
  let launchSec: number;
  let cruise = DRONE_SPEED_KMH;
  if (fromStation) {
    // 소방차와 같이 출동(즉시 이륙)해 늘 소방차 앞에서 날도록, 정찰 구간에 TARGET_LEAD_SEC 먼저 닿는 속도로 순항 (최대 54km/h)
    launchSec = minLaunch;
    const avail = truckEntrySec - TARGET_LEAD_SEC - launchSec;
    if (avail > 0) cruise = Math.min(DRONE_SPEED_KMH, Math.max(20, (flight.plannedKm / avail) * 3600));
  } else {
    // 권장 이륙 시각: 소방차보다 TARGET_LEAD_SEC 먼저 도착하도록. 늦으면 즉시 이륙.
    const flightSec = (flight.plannedKm / DRONE_SPEED_KMH) * 3600;
    launchSec = Math.max(minLaunch, truckEntrySec - TARGET_LEAD_SEC - flightSec - LAUNCH_PREP_SEC);
  }
  // 출동 소방서 드론은 소방차와 동시에 출발 (도크에서 출동 지령과 함께 이륙), 다른 소방서 드론은 이륙 준비 시간
  const takeoff = fromStation ? launchSec : launchSec + LAUNCH_PREP_SEC;
  const points = [flight.path[0], ...flight.path, ...scanPts.slice(1)];
  const speeds = [...flight.path.slice(1).map(() => cruise), ...scanPts.slice(1).map(() => SCAN_SPEED_KMH)];
  const times = [launchSec, ...timeline(points.slice(1), speeds, takeoff)];
  const scanStartSec = times[flight.path.length];
  return {
    assignment: a,
    flight,
    points,
    times,
    totalSec: times[times.length - 1],
    launchSec,
    takeoffSec: takeoff,
    scanStartSec,
    broadcastSec: Math.max(scanStartSec, truckEntrySec - BROADCAST_BEFORE_SEC),
    truckEntrySec,
    leadSec: truckEntrySec - scanStartSec,
  };
}

/** 선 단순화 (Douglas–Peucker, 허용 오차 tolKm) — 근거리라 위경도를 평면 km 로 근사 */
function simplify(pts: LatLng[], tolKm: number): LatLng[] {
  if (pts.length < 3) return pts;
  const lat0 = (pts[0].lat * Math.PI) / 180;
  const xy = pts.map((p) => [p.lng * 111.32 * Math.cos(lat0), p.lat * 110.57]);
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = xy[i];
    const [bx, by] = xy[j];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let best = -1;
    let bestD = tolKm;
    for (let k = i + 1; k < j; k++) {
      const d = Math.abs((bx - ax) * (ay - xy[k][1]) - (ax - xy[k][0]) * (by - ay)) / len;
      if (d > bestD) {
        bestD = d;
        best = k;
      }
    }
    if (best >= 0) {
      keep[best] = true;
      stack.push([i, best], [best, j]);
    }
  }
  return pts.filter((_, k) => keep[k]);
}

/** t 초까지의 비행만 남기고 자른다 (그 순간 위치를 끝점으로) */
function trimAt(d: DroneSim, t: number): DroneSim {
  const points: LatLng[] = [];
  const times: number[] = [];
  for (let k = 0; k < d.points.length && d.times[k] <= t; k++) {
    points.push(d.points[k]);
    times.push(d.times[k]);
  }
  points.push(droneAt(d, t));
  times.push(t);
  return { ...d, points, times, totalSec: t };
}

/**
 * 우회 승인 뒤: 지금 위치에서 왔던 길(기존 경로)을 따라 갈림길까지 되돌아간 다음, 우회로를 따라 합류 지점까지 앞서 확인.
 * 되돌아가는 동안과 우회로 모두 같은 속도로 멈춤 없이 난다 (건물 위로 가로지르지 않음).
 */
function backtrackToDetour(d: DroneSim, base: ScenarioRoute, route: ScenarioRoute, from: number, rejoin: number): void {
  const b = base.road;
  const here = d.points[d.points.length - 1];
  const fJ = b.fr[from];
  // 기존 경로 위 지금 위치(비율) — 갈림길 뒤쪽에서 촘촘히 찾아 가장 가까운 곳
  let fHere = fJ;
  let best = Infinity;
  for (let k = 0; k <= 400; k++) {
    const f = fJ + ((1 - fJ) * k) / 400;
    const dd = distLatLng(here, toLatLng(b.tools.at(f)));
    if (dd < best) {
      best = dd;
      fHere = f;
    }
  }
  const back = b.tools.sub(fJ, fHere).reverse(); // 지금 위치 → 갈림길
  extend(d.points, d.times, back.slice(1).map(toLatLng), SCAN_SPEED_KMH);
  const r = route.road;
  extend(d.points, d.times, r.tools.sub(r.fr[from], r.fr[rejoin]).slice(1).map(toLatLng), SCAN_SPEED_KMH);
}

function finish(d: DroneSim): DroneSim {
  return { ...d, totalSec: d.times[d.times.length - 1] };
}

/**
 * @param choice 경로 판단 — null 이면 아직 판단 전(정찰 드론이 차단 지점에 닿을 때 판단 요청)
 */
export function buildSimPlan(sc: Scenario, decision: DispatchDecision | null, launch: boolean, choice: RouteChoice | null = null): SimPlan {
  const bl = sc.blockage;
  const assignments = decision && launch ? decision.assignments : [];
  // 전방 차단보다 앞쪽 정찰 구간을 맡은 드론이 경로를 따라 계속 선행 정찰 → 차단 발견
  const scoutA = bl
    ? assignments.filter((a) => a.cluster.lastSeg < bl.segIndex).sort((x, y) => y.cluster.lastSeg - x.cluster.lastSeg)[0]
    : undefined;
  // 막힘이 정찰 구간 안에 있으면(불법주차 등) 그 구간을 맡은 드론이 정찰하다 발견
  const inA = bl && !scoutA ? assignments.find((a) => a.cluster.firstSeg <= bl.segIndex && bl.segIndex <= a.cluster.lastSeg) : undefined;

  // 판단 전 기준 계획 (소방차는 예상 속도로 — 아직 막힘을 모름). 드론이 없으면 막힘을 그대로 지나감
  const pending = routeAndTruck(sc, "base", !scoutA && !inA);
  let scout: DroneSim | null = null;
  let blockage: BlockageInfo | null = null;
  if (bl && inA) {
    // 정찰 경로 위에서 막힌 지점에 가장 가까워지는 시각 = 발견 시각
    scout = planDrone(inA, pending.route, pending.truck);
    let best = { s: scout.totalSec, d: Infinity };
    for (let s = Math.floor(scout.scanStartSec); s <= Math.ceil(scout.totalSec); s++) {
      const dd = distLatLng(droneAt(scout, s), bl.position);
      if (dd < best.d - 1e-6) best = { s, d: dd };
      if (dd < 0.015) break;
    }
    const stay = routeAndTruck(sc, "base", true).truck;
    const det = routeAndTruck(sc, "detour", false).truck;
    blockage = {
      kind: bl.kind,
      short: bl.short,
      droneId: inA.droneId,
      atSec: best.s,
      decideBySec: pending.truck.times[bl.detour.fromSeg],
      position: bl.position,
      label: bl.label,
      summary: bl.detour.summary,
      stayArrivalSec: stay.totalSec,
      detourArrivalSec: det.totalSec,
      savedSec: stay.totalSec - det.totalSec,
    };
    if (blockage.atSec >= blockage.decideBySec) choice = "stay";
  }
  if (bl && scoutA) {
    scout = planDrone(scoutA, pending.route, pending.truck);
    const road = pending.route.road;
    const lastVertex = scoutA.cluster.lastSeg + 1;
    const fB = road.tools.nearest([bl.position.lat, bl.position.lng], road.idx[lastVertex]).f;
    scout.aheadSec = scout.times[scout.times.length - 1];
    const pts = scout.points;
    const ts = scout.times;
    // 차단 지점 25m 앞에서 멈춰 발견 — 앞을 비스듬히 보는 카메라 화면 위쪽에 막힌 현장이 보이도록
    const fStop = Math.max(road.fr[lastVertex], fB - 0.025 / road.tools.km);
    extend(pts, ts, road.tools.sub(road.fr[lastVertex], fStop).slice(1).map(toLatLng), DRONE_SPEED_KMH);
    scout = finish(scout);
    const stay = routeAndTruck(sc, "base", true).truck;
    const det = routeAndTruck(sc, "detour", false).truck;
    blockage = {
      kind: bl.kind,
      short: bl.short,
      droneId: scoutA.droneId,
      atSec: scout.totalSec,
      decideBySec: pending.truck.times[bl.detour.fromSeg],
      position: bl.position,
      label: bl.label,
      summary: bl.detour.summary,
      stayArrivalSec: stay.totalSec,
      detourArrivalSec: det.totalSec,
      savedSec: stay.totalSec - det.totalSec,
    };
    // 소방차가 이미 갈림길을 지났으면 우회 불가 → 그대로 지나감
    if (blockage.atSec >= blockage.decideBySec) choice = "stay";
  }

  const active = blockage && choice ? routeAndTruck(sc, choice === "detour" ? "detour" : "base", choice === "stay") : pending;
  const { route, truck } = active;
  const drones: DroneSim[] = [];
  for (const a of assignments) {
    if (scout && a === inA) {
      if (blockage && choice === "detour") {
        // 우회 승인: 발견 지점에서 왔던 길로 갈림길까지 되돌아가, 소방차가 갈 우회로를 앞서 비행하며 길 확인
        const d = trimAt(scout, blockage.atSec);
        const from = bl!.detour.fromSeg;
        backtrackToDetour(d, pending.route, route, from, from + bl!.detour.segments.length);
        drones.push(finish(d));
      } else {
        // 기존 경로 유지(또는 판단 전): 정찰을 이어 가며 막힌 구간·주차 차량 확인
        drones.push(scout);
      }
      continue;
    }
    if (scout && a === scoutA) {
      const d: DroneSim = { ...scout, points: [...scout.points], times: [...scout.times] };
      if (blockage && choice === "detour") {
        // 왔던 길로 갈림길까지 되돌아가 우회로를 앞서 비행하며 확인 (발견 지점 → 갈림길 → 우회로 → 합류 지점)
        const from = bl!.detour.fromSeg;
        backtrackToDetour(d, pending.route, route, from, from + bl!.detour.segments.length);
      } else if (blockage && choice === "stay") {
        // 막힌 구간을 따라가며 확인
        const r = route.road;
        const fB = r.tools.nearest([bl!.position.lat, bl!.position.lng], r.idx[bl!.segIndex]).f;
        extend(d.points, d.times, r.tools.sub(Math.max(0, fB - 0.025 / r.tools.km), r.fr[bl!.segIndex + 1]).slice(1).map(toLatLng), SCAN_SPEED_KMH);
      }
      drones.push(finish(d));
      continue;
    }
    if (!blockage || !choice) {
      drones.push(planDrone(a, route, truck));
      continue;
    }
    // 경로 판단 뒤: 판단 전에 이미 이륙한 드론은 그 비행을 유지, 아니면 바뀐 경로로 다시 계산(판단 이후 이륙)
    const before = planDrone(a, pending.route, pending.truck);
    if (before.launchSec <= blockage.atSec) {
      const entry = truck.times[a.cluster.firstSeg];
      drones.push({ ...before, truckEntrySec: entry, leadSec: entry - before.scanStartSec, broadcastSec: Math.max(before.scanStartSec, entry - BROADCAST_BEFORE_SEC) });
    } else drones.push(planDrone(a, route, truck, blockage.atSec));
  }

  // 탐지: 위반 차량에서 150m 이내를 지나는 정찰 드론 중 가장 먼저 지나는 시각
  const detections: SimPlan["detections"] = [];
  for (const v of sc.violations) {
    let best: { droneId: string; atSec: number; d: number } | null = null;
    for (const d of drones) {
      if (d.assignment.role !== "guide+detect") continue;
      for (let s = Math.floor(d.scanStartSec); s <= Math.ceil(d.totalSec); s++) {
        const dd = distLatLng(droneAt(d, s), v.position);
        if (dd < 0.15 && (!best || dd < best.d)) best = { droneId: d.assignment.droneId, atSec: s, d: dd };
      }
    }
    if (best) detections.push({ violationId: v.id, droneId: best.droneId, atSec: best.atSec });
  }
  detections.sort((a, b) => a.atSec - b.atSec);

  return { route, truck, drones, detections, blockage, endSec: truck.totalSec + 5 };
}
