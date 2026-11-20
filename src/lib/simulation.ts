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
  const flight = planFlight(a.base.position, entry, []);
  const flightSec = (flight.plannedKm / DRONE_SPEED_KMH) * 3600;
  const truckEntrySec = truck.times[first];
  // 권장 이륙 시각: 소방차보다 TARGET_LEAD_SEC 먼저 도착하도록. 늦으면 즉시 이륙.
  const launchSec = Math.max(minLaunch, truckEntrySec - TARGET_LEAD_SEC - flightSec - LAUNCH_PREP_SEC);
  const takeoff = launchSec + LAUNCH_PREP_SEC;
  const points = [flight.path[0], ...flight.path, ...scanPts.slice(1)];
  const speeds = [...flight.path.slice(1).map(() => DRONE_SPEED_KMH), ...scanPts.slice(1).map(() => SCAN_SPEED_KMH)];
  const times = [launchSec, ...timeline(points.slice(1), speeds, takeoff)];
  const scanStartSec = times[flight.path.length];
  return {
    assignment: a,
    flight,
    points,
    times,
    totalSec: times[times.length - 1],
    launchSec,
    scanStartSec,
    broadcastSec: Math.max(scanStartSec, truckEntrySec - BROADCAST_BEFORE_SEC),
    truckEntrySec,
    leadSec: truckEntrySec - scanStartSec,
  };
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

  // 판단 전 기준 계획 (소방차는 예상 속도로 — 아직 사고를 모름)
  const pending = routeAndTruck(sc, "base", !scoutA);
  let scout: DroneSim | null = null;
  let blockage: BlockageInfo | null = null;
  if (bl && scoutA) {
    scout = planDrone(scoutA, pending.route, pending.truck);
    const road = pending.route.road;
    const lastVertex = scoutA.cluster.lastSeg + 1;
    const fB = road.tools.nearest([bl.position.lat, bl.position.lng], road.idx[lastVertex]).f;
    scout.aheadSec = scout.times[scout.times.length - 1];
    const pts = scout.points;
    const ts = scout.times;
    extend(pts, ts, road.tools.sub(road.fr[lastVertex], fB).slice(1).map(toLatLng), DRONE_SPEED_KMH);
    scout = finish(scout);
    const stay = routeAndTruck(sc, "base", true).truck;
    const det = routeAndTruck(sc, "detour", false).truck;
    blockage = {
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
    if (scout && a === scoutA) {
      const d: DroneSim = { ...scout, points: [...scout.points], times: [...scout.times] };
      if (blockage && choice === "detour") {
        // 우회로를 앞서 비행하며 확인 (갈림길 → 우회로 → 합류 지점)
        const r = route.road;
        const from = bl!.detour.fromSeg;
        const rejoin = from + bl!.detour.segments.length;
        extend(d.points, d.times, r.tools.sub(r.fr[from], r.fr[rejoin]).map(toLatLng), DRONE_SPEED_KMH);
      } else if (blockage && choice === "stay") {
        // 차단 구간을 따라가며 길터주기 방송
        const r = route.road;
        const fB = r.tools.nearest([bl!.position.lat, bl!.position.lng], r.idx[bl!.segIndex]).f;
        extend(d.points, d.times, r.tools.sub(fB, r.fr[bl!.segIndex + 1]).slice(1).map(toLatLng), SCAN_SPEED_KMH);
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
