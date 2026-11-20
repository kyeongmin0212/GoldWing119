"use client";

// 오프라인 대체용 개략 상황도 — 혼잡 지점, 소방차·드론 궤적 (SVG, 외부 지도 API 없음). 비행 제한 구역 표시는 추후 보완
// 상황실 콘솔과 소방차 태블릿이 같이 쓴다 (compact = 태블릿용 작은 지도).

import { useMemo } from "react";
import { MAP_KM, formatClock, speedClass, toXY, truckAt } from "@/lib/geo";
import { maskPlate } from "@/lib/plate";
import { droneAt } from "@/lib/simulation";
import type { SimView } from "@/lib/simView";
import type { LatLng } from "@/types/drone";

const S = 30; // px per km
const W = MAP_KM.w * S;
const H = MAP_KM.h * S;
const P = (p: LatLng) => {
  const q = toXY(p);
  return { x: q.x * S, y: q.y * S };
};
const pts = (arr: LatLng[]) =>
  arr
    .map(P)
    .map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

const C = {
  land: "#eef0f3",
  city: "#ffffff",
  cityLine: "#b8bfca",
  label: "#7b8494",
  avoid: "#c8102e",
  control: "#b45309",
  slow: "#eab308", // 노랑 — 소방차(#c2410c 주황 갈색)와 헷갈리지 않게
  jam: "#c8102e",
  road: "#9aa3b2",
  truck: "#c2410c",
  drone: "#1d4ed8",
  base: "#1f3a68",
  ok: "#2f7d32",
};

// 개략 지명 라벨 (공개 지도 기준 대략 위치)
const PLACE_LABELS: { name: string; at: LatLng }[] = [
  { name: "광산구", at: { lat: 35.175, lng: 126.74 } },
  { name: "서구", at: { lat: 35.135, lng: 126.86 } },
  { name: "남구", at: { lat: 35.115, lng: 126.9 } },
  { name: "동구", at: { lat: 35.135, lng: 126.95 } },
  { name: "북구", at: { lat: 35.2, lng: 126.95 } },
  { name: "나주시", at: { lat: 35.008, lng: 126.73 } },
  { name: "화순군 방면", at: { lat: 35.045, lng: 126.99 } },
  { name: "담양군 방면", at: { lat: 35.265, lng: 126.99 } },
  { name: "장성군 방면", at: { lat: 35.268, lng: 126.76 } },
];

// 옛 광주광역시 권역 경계 (개략 — 시연용 단순 다각형). 2026-07-01부터 전남광주통합특별시
const GWANGJU_OUTLINE: LatLng[] = [
  { lat: 35.255, lng: 126.735 },
  { lat: 35.262, lng: 126.86 },
  { lat: 35.235, lng: 126.96 },
  { lat: 35.18, lng: 127.02 },
  { lat: 35.105, lng: 127.0 },
  { lat: 35.075, lng: 126.92 },
  { lat: 35.05, lng: 126.84 },
  { lat: 35.075, lng: 126.73 },
  { lat: 35.13, lng: 126.69 },
  { lat: 35.2, lng: 126.7 },
];

/** 소방차 아이콘 (lucide truck 형태 단순화) */
function TruckIcon({ x, y }: { x: number; y: number }) {
  return (
    <g transform={`translate(${x - 13},${y - 10})`}>
      <rect x="0" y="0" width="26" height="20" rx="3" fill="#fff" stroke={C.truck} strokeWidth="2" />
      <path d="M4 5h10v8H4zM14 8h4l3 3v2h-7z" fill={C.truck} />
      <circle cx="7" cy="15.5" r="2" fill={C.truck} />
      <circle cx="18" cy="15.5" r="2" fill={C.truck} />
    </g>
  );
}

/** 드론 아이콘 (쿼드콥터 형태) */
function DroneIcon({ x, y, active }: { x: number; y: number; active: boolean }) {
  return (
    <g transform={`translate(${x},${y})`}>
      <circle r="13" fill="#fff" stroke={C.drone} strokeWidth={active ? 2.5 : 1.5} />
      <path d="M-5,-5 L5,5 M5,-5 L-5,5" stroke={C.drone} strokeWidth="1.6" />
      {[
        [-5, -5],
        [5, -5],
        [-5, 5],
        [5, 5],
      ].map(([a, b]) => (
        <circle key={`${a}${b}`} cx={a} cy={b} r="2.6" fill="none" stroke={C.drone} strokeWidth="1.4" />
      ))}
    </g>
  );
}

export default function SchematicMap({ sim, compact = false }: { sim: SimView; compact?: boolean }) {
  const { scenario, plan, hotspots, bases, decision, simTime, violations, launch, status } = sim;
  const segs = plan.route.segs;
  const truckPts = useMemo(() => plan.truck.points, [plan.truck.points]);
  const truck = truckAt(plan.truck, simTime);
  const started = status !== "idle";

  const traveled = useMemo(() => {
    const out = truckPts.slice(0, truck.segIndex + 1);
    out.push(truck.pos);
    return out;
  }, [truckPts, truck.segIndex, truck.pos]);

  const clusterSegs = new Set<number>();
  decision.clusters.forEach((c) => {
    for (let k = c.firstSeg; k <= c.lastSeg; k++) clusterSegs.add(k);
  });
  const activeIds = new Set(decision.matches.filter((m) => m.active).map((m) => m.hotspot.id));

  const incident = P(scenario.incident.position);
  const station = P(scenario.station.position);
  const truckP = P(truck.pos);
  const fs = compact ? 1.25 : 1; // 태블릿 작은 지도는 글자를 조금 키움

  return (
    <div className="relative h-full w-full">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" role="img" aria-label="출동 상황도">
        <defs>
          <pattern id="hatch" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="10" height="10" fill={C.avoid} fillOpacity="0.06" />
            <line x1="0" y1="0" x2="0" y2="10" stroke={C.avoid} strokeWidth="2.2" strokeOpacity="0.45" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill={C.land} />

        {/* 옛 광주 권역 (개략) */}
        <polygon points={pts(GWANGJU_OUTLINE)} fill={C.city} stroke={C.cityLine} strokeWidth="1.5" />
        {!compact &&
          PLACE_LABELS.map((l) => {
            const p = P(l.at);
            return (
              <text key={l.name} x={p.x} y={p.y} fill={C.label} fontSize={14} fontWeight={500} textAnchor="middle">
                {l.name}
              </text>
            );
          })}


        {/* 혼잡 지점 */}
        {hotspots.map((h) => {
          const c = P(h.position);
          const on = activeIds.has(h.id);
          if (!on && compact) return null;
          const color = h.kind === "불법주정차다발" ? C.slow : C.jam;
          return (
            <g key={h.id} opacity={on ? 1 : 0.35}>
              <circle cx={c.x} cy={c.y} r={0.45 * S} fill={color} fillOpacity={0.08} stroke={color} strokeWidth="1" strokeDasharray="3 3" />
              {on && !compact && (
                <text x={c.x} y={c.y - 0.45 * S - 5} fill={color} fontSize="11" textAnchor="middle" fontWeight={700} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                  {h.kind === "불법주정차다발" ? "주정차 다발" : "상습 정체"}
                </text>
              )}
            </g>
          );
        })}

        {/* 드론 거점 */}
        {!compact &&
          bases.map((b) => {
            const p = P(b.position);
            return (
              <g key={b.id}>
                <rect x={p.x - 5} y={p.y - 5} width="10" height="10" fill="#fff" stroke={C.base} strokeWidth="1.5" />
                <text x={p.x + 9} y={p.y + 4} fill={C.base} fontSize="11">
                  {b.name}
                </text>
              </g>
            );
          })}

        {/* 소방차 경로 — 소통 등급 색 */}
        {truckPts.slice(1).map((p, k) => {
          const a = P(truckPts[k]);
          const b = P(p);
          const cls = speedClass(segs[k].speedKmh);
          const color = cls === "정체" ? C.jam : cls === "서행" ? C.slow : C.road;
          return (
            <line
              key={k}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={color}
              strokeWidth={clusterSegs.has(k) ? 7 : 5}
              strokeLinecap="round"
              opacity={0.9}
            >
              <title>{`${segs[k].label ?? ""} — ${segs[k].speedKmh}km/h (${cls})`}</title>
            </line>
          );
        })}
        <polyline points={pts(traveled)} fill="none" stroke={C.truck} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="1 0" />

        {/* 드론 경로 */}
        {launch &&
          plan.drones.map((d) => {
            const f = d.flight;
            const a = P(f.path[0]);
            const b = P(f.path[f.path.length - 1]);
            const pos = droneAt(d, simTime);
            const dp = P(pos);
            const flying = simTime >= d.launchSec;
            const flown: LatLng[] = [];
            for (let k = 0; k < d.points.length; k++) {
              if (d.times[k] <= simTime) flown.push(d.points[k]);
              else break;
            }
            flown.push(pos);
            const focus = sim.focusDrone === d.assignment.droneId;
            return (
              <g key={d.assignment.droneId}>
                <polyline points={pts(d.points.slice(1))} fill="none" stroke={C.drone} strokeOpacity="0.4" strokeWidth="2" strokeDasharray="6 5" />
                {flying && <polyline points={pts(flown)} fill="none" stroke={C.drone} strokeWidth="2.5" strokeLinejoin="round" />}
                {flying && (
                  <g onClick={() => sim.setFocusDrone(d.assignment.droneId)} style={{ cursor: "pointer" }}>
                    <DroneIcon x={dp.x} y={dp.y} active={focus} />
                    <text x={dp.x + 17} y={dp.y - 6} fill={C.drone} fontSize={12 * fs} fontWeight={700} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                      {d.assignment.droneId}
                    </text>
                  </g>
                )}
              </g>
            );
          })}

        {/* 탐지 차량 */}
        {violations.map((v) => {
          const p = P(v.position);
          const done = v.status === "reviewed";
          const color = done ? C.ok : C.avoid;
          return (
            <g key={v.id} transform={`translate(${p.x},${p.y})`} onClick={() => sim.setSelectedId(v.id)} style={{ cursor: "pointer" }}>
              <rect x="-6" y="-6" width="12" height="12" fill="#fff" stroke={color} strokeWidth="2.2" />
              <text x="10" y="17" fill={color} fontSize={11 * fs} fontWeight={700} stroke="#fff" strokeWidth="3" paintOrder="stroke">
                {maskPlate(v.plate)}
              </text>
            </g>
          );
        })}

        {/* 출발 소방서 · 현장 · 소방차 */}
        <g transform={`translate(${station.x},${station.y})`}>
          <rect x="-7" y="-7" width="14" height="14" fill={C.truck} />
          <text x="-11" y="-11" fill={C.truck} fontSize={12 * fs} textAnchor="end" fontWeight={700} stroke="#fff" strokeWidth="3" paintOrder="stroke">
            {scenario.station.name}
          </text>
        </g>
        <g transform={`translate(${incident.x},${incident.y})`}>
          <circle r="10" fill="#fff" stroke={C.avoid} strokeWidth="2.5" />
          <path d="M0,-5 C3,-1 4,1 4,3 A4,4 0 0 1 -4,3 C-4,1 -2,-1 0,-5 Z" fill={C.avoid} />
          <text x="14" y="-12" fill={C.avoid} fontSize={12 * fs} fontWeight={700} stroke="#fff" strokeWidth="3" paintOrder="stroke">
            {scenario.incident.name}
          </text>
        </g>
        {started && <TruckIcon x={truckP.x} y={truckP.y} />}
      </svg>

      {!compact && (
        <div className="pointer-events-none absolute left-2 top-2 space-y-1 border border-line bg-white/95 p-2 text-[11px] text-muted">
          <div className="flex items-center gap-2">
            <span className="inline-block h-1 w-4 bg-fire" /> 정체 15 km/h 이하 <span className="ml-1 inline-block h-1 w-4 bg-yellow-500" /> 서행 15 초과~25 km/h 미만
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 bg-truck" /> 소방차 <span className="ml-1 inline-block h-0.5 w-4 bg-drone" /> 드론 정찰 경로 (원격 조종자가 소방차 앞길을 미리 확인)
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border border-dashed border-fire bg-fire/10" /> 혼잡 지점 반경 450 m (빨강 상습 정체 · 노랑 주정차 다발)
          </div>
          <div className="text-faint">비행 제한 구역은 아직 지도에 반영하지 않음 (추후 보완)</div>
        </div>
      )}

      {!compact && started && (
        <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-2 text-[12px]">
          <div className="border border-line bg-white/95 px-2.5 py-1.5">
            <span className="text-muted">소방차 현장 도착 예정 </span>
            <b className="font-mono">T+{formatClock(plan.truck.totalSec)}</b>
            <span className="text-faint"> {status === "rerouting" ? "(경로 선택 대기 · 막힘 반영 전)" : `(평시 ${formatClock(decision.normalSec)})`}</span>
          </div>
          {launch &&
            plan.drones.map((d) => (
              <div key={d.assignment.droneId} className="border border-line bg-white/95 px-2.5 py-1.5">
                <span className="text-muted">{d.assignment.droneId} → {d.assignment.cluster.hotspots[0]?.name ?? d.assignment.cluster.label} </span>
                <b className="font-mono text-drone">T+{formatClock(d.scanStartSec)}</b>
                <span className="text-ok"> · 소방차보다 {formatClock(d.leadSec)} 먼저</span>
              </div>
            ))}
          {launch === false && <div className="border border-line bg-white/95 px-2.5 py-1.5 text-muted">드론 미투입 — 소방차 단독 출동</div>}
        </div>
      )}
    </div>
  );
}
