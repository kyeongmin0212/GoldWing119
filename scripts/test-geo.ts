// 검증: 투입 판단 규칙, 드론이 소방차 경로를 따라 정찰하는지, 선행 시간(3~5분), 탐지, 전방 차단·우회로 판단
// (비행 제한 구역 반영은 추후 보완 — 지금은 검사하지 않음)
import { SCENARIOS } from "../src/data/scenarioData.ts";
import { HOTSPOTS } from "../src/data/congestionDb.ts";
import { DRONE_BASES, DRONE_POOL_TOTAL } from "../src/data/droneBases.ts";
import { distLatLng, formatClock, mapJurisdiction, truckAt } from "../src/lib/geo.ts";
import { decideDispatch } from "../src/lib/dispatch.ts";
import { buildSimPlan, droneAt, type SimPlan } from "../src/lib/simulation.ts";
import type { RouteChoice, Scenario } from "../src/types/drone.ts";

const expected = { regional: 1, urban: 1 } as const;
let failed = 0;
const fail = (m: string) => { console.log("  ✗ " + m); failed++; };

/** 드론 정찰 궤적이 소방차 도로에서 벗어나지 않는지 (정찰 시작 이후 점들이 도로 선 60m 이내) */
function followsRoad(plan: SimPlan, droneIdx: number): boolean {
  const d = plan.drones[droneIdx];
  const line = plan.route.road.line.map(([lat, lng]) => ({ lat, lng }));
  const startK = d.times.findIndex((t) => t >= d.scanStartSec);
  return d.points.slice(startK).every((p) => line.some((q) => distLatLng(p, q) < 0.06));
}

/** 출동 소방서 드론은 이륙 직후(약 1분 반) 소방차를 앞질러 정찰 구간 도착까지 늘 소방차보다 앞(도로상 위치)에 있어야 한다 */
function staysAhead(plan: SimPlan, droneIdx: number): boolean {
  const d = plan.drones[droneIdx];
  if (distLatLng(d.assignment.base.position, plan.truck.points[0]) >= 0.5) return true;
  const tools = plan.route.road.tools;
  let idx = 0;
  for (let t = d.launchSec + 90; t <= d.scanStartSec; t += 15) { // 이륙 준비 25초 동안 먼저 출발한 소방차를 따라잡는 시간 제외
    const dp = droneAt(d, t);
    const tp = truckAt(plan.truck, t).pos;
    const fd = tools.nearest([dp.lat, dp.lng]).f;
    const ft = tools.nearest([tp.lat, tp.lng]).f;
    idx++;
    if (fd + 1e-4 < ft) return false;
  }
  return idx > 0;
}

function report(sc: Scenario, plan: SimPlan, label: string) {
  console.log(`  ${label} 소방차 현장 도착 ${formatClock(plan.truck.totalSec)} (${plan.truck.totalKm.toFixed(1)}km)`);
  plan.drones.forEach((d, i) => {
    console.log(`  🚁 ${d.assignment.droneId} (${d.assignment.base.name}) → ${d.assignment.cluster.label} [${d.assignment.role}] 이륙 ${formatClock(d.launchSec)}`);
    console.log(`     정찰구간 도착 드론 ${formatClock(d.scanStartSec)} / 소방차 ${formatClock(d.truckEntrySec)} → 선행 ${formatClock(d.leadSec)}`);
    if (d.leadSec < 180 || d.leadSec > 300) fail(`${label} ${d.assignment.droneId} 선행 시간 ${formatClock(d.leadSec)} 이 3~5분 범위 밖`);
    if (label !== "[우회]" && !followsRoad(plan, i)) fail(`${label} ${d.assignment.droneId} 정찰 궤적이 소방차 도로를 벗어남`);
    if (!staysAhead(plan, i)) fail(`${label} ${d.assignment.droneId} 출동 소방서 드론이 소방차 뒤로 처짐`);
  });
  for (const det of plan.detections) {
    const vio = sc.violations.find((x) => x.id === det.violationId)!;
    console.log(`  탐지 ${det.violationId} by ${det.droneId} @ ${formatClock(det.atSec)} — ${mapJurisdiction(vio.position).name}`);
  }
  if (plan.detections.length !== sc.violations.length) fail(`${label} 탐지 ${plan.detections.length}/${sc.violations.length}`);
}

for (const sc of Object.values(SCENARIOS)) {
  const dec = decideDispatch(sc, HOTSPOTS, DRONE_BASES);
  const plan = buildSimPlan(sc, dec, true);
  console.log(`\n[${sc.mode}] ${sc.title}`);
  dec.reasons.forEach((r) => console.log("  · " + r));
  if (dec.recommend !== expected[sc.mode]) fail(`투입 대수 ${dec.recommend} ≠ 기대 ${expected[sc.mode]}`);
  if (!plan.blockage) {
    report(sc, plan, "");
    continue;
  }
  const b = plan.blockage;
  console.log(`  ⚠ ${b.droneId} 선행 정찰 중 전방 차단 발견 @ ${formatClock(b.atSec)} — ${b.label} (소방차 갈림길 도착 ${formatClock(b.decideBySec)})`);
  console.log(`    기존 유지 ${formatClock(b.stayArrivalSec)} / 우회 ${formatClock(b.detourArrivalSec)} → ${formatClock(b.savedSec)} 단축 · ${b.summary}`);
  if (b.atSec >= b.decideBySec) fail("소방차가 갈림길을 지난 뒤에 발견 — 우회 판단 불가");
  if (b.savedSec <= 0) fail("우회로가 더 빠르지 않음");
  for (const [ch, label] of [["detour", "[우회]"], ["stay", "[유지]"]] as [RouteChoice, string][]) {
    const p = buildSimPlan(sc, dec, true, ch);
    // 판단 전과 판단 후 계획이 판단 시각 전까지 같은지 (소방차 위치)
    for (let s = 0; s < b.atSec; s += 30) {
      const a = plan.truck, c = p.truck;
      const pa = a.points.length && c.points.length ? [a, c].map((t) => { let k = 0; while (k < t.times.length - 2 && t.times[k + 1] <= s) k++; return k; }) : [0, 0];
      if (pa[0] !== pa[1]) { fail(`${label} 판단 전 소방차 위치가 다름 @ ${formatClock(s)}`); break; }
    }
    p.drones.forEach((d) => { if (d.launchSec < b.atSec && plan.drones.find((x) => x.assignment.droneId === d.assignment.droneId)!.launchSec !== d.launchSec) fail(`${label} ${d.assignment.droneId} 판단 전 이륙 시각이 바뀜`); });
    report(sc, p, label);
  }
}
if (DRONE_POOL_TOTAL !== 18) fail(`시범 드론 풀 ${DRONE_POOL_TOTAL}대 ≠ 18대`);
if (DRONE_BASES.some((b) => b.capacity !== 3)) fail("거점당 3대가 아님");
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exit(failed ? 1 : 0);
