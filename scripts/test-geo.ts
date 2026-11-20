// 검증: 투입 판단 규칙, 드론 경로의 비행금지구역 회피, 선행 시간(3~5분)
import { NO_FLY_ZONES } from "../src/data/noFlyZones.ts";
import { SCENARIOS } from "../src/data/scenarioData.ts";
import { HOTSPOTS } from "../src/data/congestionDb.ts";
import { DRONE_BASES, DRONE_POOL_TOTAL } from "../src/data/droneBases.ts";
import { validatePath, formatClock, mapJurisdiction } from "../src/lib/geo.ts";
import { decideDispatch } from "../src/lib/dispatch.ts";
import { buildSimPlan } from "../src/lib/simulation.ts";

const expected = { urban: 1, regional: 2, night: 0 } as const;
let failed = 0;
const fail = (m: string) => { console.log("  ✗ " + m); failed++; };

for (const sc of Object.values(SCENARIOS)) {
  const dec = decideDispatch(sc, HOTSPOTS, DRONE_BASES);
  const plan = buildSimPlan(sc, NO_FLY_ZONES, dec, true);
  console.log(`\n[${sc.mode}] ${sc.title}`);
  dec.reasons.forEach((r) => console.log("  · " + r));
  console.log(`  소방차 현장 도착 ${formatClock(plan.truck.totalSec)} (${plan.truck.totalKm.toFixed(1)}km)`);
  if (dec.recommend !== expected[sc.mode]) fail(`투입 대수 ${dec.recommend} ≠ 기대 ${expected[sc.mode]}`);
  for (const d of plan.drones) {
    const v = validatePath(d.flight.path, NO_FLY_ZONES);
    console.log(`  🚁 ${d.assignment.droneId} (${d.assignment.base.name}) → ${d.assignment.cluster.label} [${d.assignment.role}]`);
    console.log(`     직선 ${d.flight.directKm.toFixed(2)}km / 계획 ${d.flight.plannedKm.toFixed(2)}km, 차단=${d.flight.blockedBy.join(",") || "없음"}, 겹침=${v.ok ? "없음" : v.violations.join(",")}`);
    console.log(`     정찰구간 도착 드론 ${formatClock(d.scanStartSec)} / 소방차 ${formatClock(d.truckEntrySec)} → 선행 ${formatClock(d.leadSec)}`);
    if (!v.ok) fail("금지구역 겹침");
    if (d.leadSec < 180 || d.leadSec > 300) fail(`선행 시간 ${formatClock(d.leadSec)} 이 3~5분 범위 밖`);
  }
  for (const det of plan.detections) {
    const vio = sc.violations.find((x) => x.id === det.violationId)!;
    console.log(`  탐지 ${det.violationId} by ${det.droneId} @ ${formatClock(det.atSec)} — ${mapJurisdiction(vio.position).name}`);
  }
  if (plan.detections.length !== sc.violations.length) fail(`탐지 ${plan.detections.length}/${sc.violations.length}`);
}
if (!SCENARIOS.urban || !buildSimPlan(SCENARIOS.urban, NO_FLY_ZONES, decideDispatch(SCENARIOS.urban, HOTSPOTS, DRONE_BASES), true).drones.some((d) => d.flight.avoided)) fail("도심형에서 공항 회피가 보이지 않음");
if (DRONE_POOL_TOTAL !== 18) fail(`시범 드론 풀 ${DRONE_POOL_TOTAL}대 ≠ 18대`);
if (DRONE_BASES.some((b) => b.capacity !== 3)) fail("거점당 3대가 아님");
console.log(failed ? `\nFAIL (${failed})` : "\nPASS");
process.exit(failed ? 1 : 0);
