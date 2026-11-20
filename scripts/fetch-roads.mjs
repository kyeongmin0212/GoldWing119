// 소방차 실제 도로 경로를 OSRM(공개 데모 서버)에서 1회 받아 저장한다.
// 출발 소방서 → (경로에 걸린 혼잡 지점들, 경로 순서) → 현장 을 지나는 도로 경로.
// 사용: node --experimental-strip-types scripts/fetch-roads.mjs .   (시나리오·혼잡 지점·우회로를 바꾸면 다시 실행)
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.argv[2];
const { SCENARIOS } = await import(pathToFileURL(path.join(root, "src/data/scenarioData.ts")).href);
const { HOTSPOTS } = await import(pathToFileURL(path.join(root, "src/data/congestionDb.ts")).href);

async function osrm(pts) {
  const coord = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coord}?overview=full&geometries=geojson`;
  const r = await fetch(url, { headers: { "User-Agent": "gj-wing-hackathon-demo/1.0" } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const d = await r.json();
  if (d.code !== "Ok") throw new Error(`${d.code} ${d.message ?? ""}`);
  await new Promise((res) => setTimeout(res, 1100));
  return d;
}

const out = {};
const detours = {};
for (const [mode, sc] of Object.entries(SCENARIOS)) {
  const ids = [];
  sc.truckRoute.forEach((s) => s.hotspotId && !ids.includes(s.hotspotId) && ids.push(s.hotspotId));
  const vias = ids.map((id) => HOTSPOTS.find((h) => h.id === id).position);
  const pts = [sc.truckStart, ...vias, sc.incident.position];
  const coord = pts.map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/route/v1/driving/${coord}?overview=full&geometries=geojson`;
  const r = await fetch(url, { headers: { "User-Agent": "gj-wing-hackathon-demo/1.0" } });
  if (!r.ok) throw new Error(`${mode}: HTTP ${r.status}`);
  const d = await r.json();
  if (d.code !== "Ok") throw new Error(`${mode}: ${d.code} ${d.message ?? ""}`);
  const line = d.routes[0].geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(6), +lng.toFixed(6)]);
  out[mode] = { distanceM: Math.round(d.routes[0].distance), line };
  console.log(mode, `${(d.routes[0].distance / 1000).toFixed(1)}km`, `${line.length}pts`, "| via", d.waypoints.map((w) => `${w.name || "?"}(${Math.round(w.distance)}m)`).join(" → "));
  await new Promise((res) => setTimeout(res, 1100));
  // 우회로: 갈림길 꼭짓점 → 우회 구간 끝점들
  if (sc.blockage) {
    const { fromSeg, segments } = sc.blockage.detour;
    const j = fromSeg === 0 ? sc.truckStart : sc.truckRoute[fromSeg - 1].to;
    const dd = await osrm([j, ...segments.map((x) => x.to)]);
    const dl = dd.routes[0].geometry.coordinates.map(([lng, lat]) => [+lat.toFixed(6), +lng.toFixed(6)]);
    detours[mode] = { distanceM: Math.round(dd.routes[0].distance), line: dl };
    console.log(mode, "detour", `${(dd.routes[0].distance / 1000).toFixed(2)}km`, `${dl.length}pts`);
  }
}

const ts = `// 소방차 경로의 실제 도로 모양 — OSRM 공개 데모 서버, OpenStreetMap 도로 데이터 기준 (${new Date().toISOString().slice(0, 10)} 1회 생성)
// 출발 소방서 → 경로상 혼잡 지점 → 현장을 지나는 도로 경로. 시뮬레이션 구간은 이 선 위에 비율로 대응시켜 그린다.
// 도로 데이터 © OpenStreetMap 기여자 (ODbL). 시나리오·혼잡 지점을 바꾸면 다시 생성해야 한다.

import type { ScenarioMode } from "../types/drone.ts";

export const ROAD_GEOMETRY: Record<ScenarioMode, { distanceM: number; line: [number, number][] }> = ${JSON.stringify(out)};

/** 전방 차단 시 우회로 (갈림길 → 우회 구간 끝, 기존 경로에 다시 합류) */
export const DETOUR_GEOMETRY: Partial<Record<ScenarioMode, { distanceM: number; line: [number, number][] }>> = ${JSON.stringify(detours)};
`;
writeFileSync(path.join(root, "src/data/roadGeometry.ts"), ts, "utf8");
console.log("written src/data/roadGeometry.ts");
