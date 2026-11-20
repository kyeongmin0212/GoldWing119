// 시나리오 + 투입 결정 → 시뮬레이션 계획(소방차·드론 타임라인, 탐지 시각). 순수 함수.

import type { DispatchDecision, DroneAssignment, LatLng, NoFlyZone, Scenario } from "../types/drone.ts";
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
}

export interface SimPlan {
  truck: TruckTimeline;
  drones: DroneSim[];
  detections: { violationId: string; droneId: string; atSec: number }[];
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

export function droneAt(d: Pick<DroneSim, "points" | "times" | "totalSec">, sec: number): LatLng {
  if (sec <= d.times[0]) return d.points[0];
  return truckAt({ points: d.points, times: d.times, totalSec: d.totalSec, totalKm: 0 }, sec).pos;
}

export function buildSimPlan(sc: Scenario, zones: NoFlyZone[], decision: DispatchDecision | null, launch: boolean): SimPlan {
  const truck = buildTruckTimeline(sc.truckStart, sc.truckRoute);
  const drones: DroneSim[] = [];

  if (decision && launch) {
    for (const a of decision.assignments) {
      const entry = truck.points[a.cluster.firstSeg];
      // 정찰 구간: 묶음 입구 ~ 묶음 끝 (현장 직전 묶음이면 현장까지)
      const lastVertex = a.cluster.lastSeg + 1 >= truck.points.length - 2 ? truck.points.length - 1 : a.cluster.lastSeg + 1;
      const scanPts = truck.points.slice(a.cluster.firstSeg, lastVertex + 1);
      const flight = planFlight(a.base.position, entry, zones);
      const flightSec = (flight.plannedKm / DRONE_SPEED_KMH) * 3600;
      const truckEntrySec = truck.times[a.cluster.firstSeg];
      // 이륙 시각: 소방차보다 TARGET_LEAD_SEC 먼저 도착하도록. 늦으면 즉시 이륙.
      const launchSec = Math.max(0, truckEntrySec - TARGET_LEAD_SEC - flightSec - LAUNCH_PREP_SEC);
      const takeoff = launchSec + LAUNCH_PREP_SEC;
      const points = [flight.path[0], ...flight.path, ...scanPts.slice(1)];
      const speeds = [
        ...flight.path.slice(1).map(() => DRONE_SPEED_KMH),
        ...scanPts.slice(1).map(() => SCAN_SPEED_KMH),
      ];
      const times = [launchSec, ...timeline(points.slice(1), speeds, takeoff)];
      const scanStartSec = times[flight.path.length];
      drones.push({
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
      });
    }
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

  return { truck, drones, detections, endSec: truck.totalSec + 5 };
}
