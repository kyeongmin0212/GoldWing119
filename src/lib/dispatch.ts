// 드론 투입 판단 — 결정적 규칙 (모델이 아닌 코드가 계산, 관제요원이 승인)
// 규칙: 예상 지연 ≥ 3분 또는 경로에 활성 혼잡 DB 지점 포함 → 투입 권고
//       혼잡 묶음(1.5km 이내) 1개 → 1대, 서로 떨어진 2개 이상 → 2대(최대 2대), 해당 없음 → 투입 안 함
//       배차: 출동 소방서 거점의 드론 우선 (정찰 구간 입구가 운용반경 10km 안일 때), 아니면 입구에서 가장 가까운 거점

import type {
  DispatchDecision,
  DroneAssignment,
  DroneBase,
  Hotspot,
  HotspotCluster,
  HotspotMatch,
  RoadSegment,
  Scenario,
} from "../types/drone.ts";
import { isActive } from "../data/congestionDb.ts";
import { distLatLng, formatClock } from "./geo.ts";
import { scenarioRoad } from "./road.ts";

export const RUSH_HOURS: [number, number][] = [
  [7, 9],
  [17, 20],
];
export const CLUSTER_KM = 1.5;
export const DELAY_THRESHOLD_SEC = 180;
export const MAX_DRONES_PER_INCIDENT = 2;
/** 도크형 드론 운용반경 (DJI Dock 3 + Matrice 4D 사양 10km) */
export const DRONE_RANGE_KM = 10;
/** 출동 소방서와 같은 곳으로 보는 거리 */
const SAME_SITE_KM = 0.5;

export function freeFlow(s: RoadSegment): number {
  return s.freeFlowKmh ?? (s.congested ? Math.max(s.speedKmh, 50) : s.speedKmh);
}

export function routeTimes(sc: Scenario): { normalSec: number; expectedSec: number; segDelay: number[] } {
  const { segKm } = scenarioRoad(sc); // 구간별 실제 도로 거리
  let normalSec = 0;
  let expectedSec = 0;
  const segDelay: number[] = [];
  sc.truckRoute.forEach((s, i) => {
    const d = segKm[i];
    const n = (d / freeFlow(s)) * 3600;
    const e = (d / s.speedKmh) * 3600;
    normalSec += n;
    expectedSec += e;
    segDelay.push(e - n);
  });
  return { normalSec, expectedSec, segDelay };
}

/** 거점별 드론 ID — 예: B-BG 거점 → BG-D01 */
function droneIdFor(base: DroneBase, n: number): string {
  return `${base.id.replace(/^B-/, "")}-D${String(n).padStart(2, "0")}`;
}

export function decideDispatch(sc: Scenario, hotspots: Hotspot[], bases: DroneBase[]): DispatchDecision {
  const hour = Number(sc.incident.reportedAt.split(":")[0]);
  const rushHour = RUSH_HOURS.some(([s, e]) => hour >= s && hour < e);
  const pts = [sc.truckStart, ...sc.truckRoute.map((s) => s.to)];
  const { normalSec, expectedSec, segDelay } = routeTimes(sc);
  const delaySec = expectedSec - normalSec;

  // 1) 경로 구간에 걸린 혼잡 DB 지점
  const matches: HotspotMatch[] = [];
  for (const h of hotspots) {
    const segs = sc.truckRoute.map((s, i) => (s.hotspotId === h.id ? i : -1)).filter((i) => i >= 0);
    if (segs.length) matches.push({ hotspot: h, active: isActive(h, hour), segIndex: segs[0], lastSegIndex: segs[segs.length - 1] });
  }
  const active = matches.filter((m) => m.active).sort((a, b) => a.segIndex - b.segIndex);

  // 2) 가까운 지점끼리 묶기 (경로 순서대로)
  const clusters: HotspotCluster[] = [];
  for (const m of active) {
    const last = clusters[clusters.length - 1];
    if (last && last.hotspots.some((h) => distLatLng(h.position, m.hotspot.position) <= CLUSTER_KM)) {
      last.hotspots.push(m.hotspot);
      last.firstSeg = Math.min(last.firstSeg, m.segIndex);
      last.lastSeg = Math.max(last.lastSeg, m.lastSegIndex);
    } else {
      clusters.push({ id: `C${clusters.length + 1}`, hotspots: [m.hotspot], firstSeg: m.segIndex, lastSeg: m.lastSegIndex, label: "" });
    }
  }
  // DB 지점은 없는데 지연만 큰 경우 — 가장 지연이 큰 구간 하나
  if (!clusters.length && delaySec >= DELAY_THRESHOLD_SEC) {
    const worst = segDelay.indexOf(Math.max(...segDelay));
    clusters.push({ id: "C1", hotspots: [], firstSeg: worst, lastSeg: worst, label: sc.truckRoute[worst].label ?? "지연 구간" });
  }
  clusters.forEach((c) => {
    if (!c.label) c.label = c.hotspots.map((h) => h.name).join(" + ");
  });

  // 3) 투입 대수와 근거
  const recommend = Math.min(MAX_DRONES_PER_INCIDENT, clusters.length);
  const inactive = matches.filter((m) => !m.active);
  const reasons: string[] = [
    `신고 시각 ${sc.incident.reportedAt} — ${rushHour ? "출퇴근 시간대(07–09·17–20시)" : "평시 시간대"}`,
    `평시 대비 예상 지연 ${formatClock(Math.max(0, delaySec))} (기준 ${formatClock(DELAY_THRESHOLD_SEC)})`,
    active.length ? `경로상 혼잡 DB 지점 ${active.length}곳: ${active.map((m) => m.hotspot.name).join(", ")}` : "경로상 활성 혼잡 DB 지점 없음",
  ];
  if (inactive.length) reasons.push(`시간대 외 비활성 지점 ${inactive.length}곳 제외`);
  if (recommend === 0) reasons.push("→ 투입 불필요: 소방차만 출동");
  else if (clusters.length === 1) reasons.push(`→ 혼잡 지점이 한 묶음(${CLUSTER_KM}km 이내) → 드론 1대`);
  else reasons.push(`→ 서로 떨어진 혼잡 묶음 ${clusters.length}개 → 드론 ${recommend}대 (1건당 최대 ${MAX_DRONES_PER_INCIDENT}대)`);

  // 4) 배차
  const usedPerBase = new Map<string, number>();
  const free = (b: DroneBase) => (usedPerBase.get(b.id) ?? 0) < b.capacity;
  const home = bases.find((b) => distLatLng(b.position, sc.station.position) <= SAME_SITE_KM);
  const assignments: DroneAssignment[] = clusters.slice(0, recommend).map((c) => {
    const entry = pts[c.firstSeg];
    const sorted = [...bases].sort((a, b) => distLatLng(a.position, entry) - distLatLng(b.position, entry));
    const homeOk = home && free(home) && distLatLng(home.position, entry) <= DRONE_RANGE_KM;
    const base = homeOk ? home : (sorted.find(free) ?? sorted[0]);
    const n = (usedPerBase.get(base.id) ?? 0) + 1;
    usedPerBase.set(base.id, n);
    const detect = c.hotspots.some((h) => h.kind === "불법주정차다발") || c.lastSeg === sc.truckRoute.length - 1;
    return { droneId: droneIdFor(base, n), base, cluster: c, role: detect ? "guide+detect" : "guide" };
  });

  return { reportedAt: sc.incident.reportedAt, hour, rushHour, normalSec, expectedSec, delaySec, matches, clusters, recommend, reasons, assignments };
}
