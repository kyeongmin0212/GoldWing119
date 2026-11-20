"use client";

// 전남·광주 전술 GIS 맵 — 비행금지구역, 혼잡 DB, 소방차 vs 선행 드론 궤적 (SVG, 외부 지도 API 없음)

import { useMemo } from "react";
import { MAP_KM, formatClock, speedClass, toXY, truckAt } from "@/lib/geo";
import { droneAt } from "@/lib/simulation";
import type { SimController } from "@/lib/useGoldenTimeSim";
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

// 개략 지명 라벨 (공개 지도 기준 대략 위치)
const PLACE_LABELS: { name: string; at: LatLng; big?: boolean }[] = [
  { name: "광산구", at: { lat: 35.175, lng: 126.74 } },
  { name: "서구", at: { lat: 35.135, lng: 126.86 } },
  { name: "남구", at: { lat: 35.115, lng: 126.9 } },
  { name: "동구", at: { lat: 35.135, lng: 126.95 } },
  { name: "북구", at: { lat: 35.2, lng: 126.95 } },
  { name: "나주시 (혁신도시)", at: { lat: 35.008, lng: 126.73 }, big: true },
  { name: "화순 방면 →", at: { lat: 35.045, lng: 126.99 } },
  { name: "담양 방면 ↗", at: { lat: 35.265, lng: 126.99 } },
  { name: "장성 방면 ↑", at: { lat: 35.268, lng: 126.76 } },
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

export default function TacticalMap({ sim }: { sim: SimController }) {
  const { scenario, plan, zones, controlZones, hotspots, bases, decision, simTime, violations, launch, status } = sim;
  const truckPts = useMemo(() => plan.truck.points, [plan.truck.points]);
  const truck = truckAt(plan.truck, simTime);
  const started = status !== "idle";

  // 소방차가 지나온 경로
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

  return (
    <section className="panel relative flex min-h-[360px] flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-ink-700 px-3 py-2">
        <span className="panel-title">전술 GIS — 전남·광주 경계 실시간 관제</span>
        <span className="text-[11px] text-ink-400">지형·경계·구역은 개략/가상 (시연용)</span>
      </div>

      <div className="relative min-h-0 flex-1">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="absolute inset-0 h-full w-full" role="img" aria-label="전술 지도">
          <defs>
            <pattern id="grid" width={S} height={S} patternUnits="userSpaceOnUse">
              <path d={`M ${S} 0 L 0 0 0 ${S}`} fill="none" stroke="#16202f" strokeWidth="1" />
            </pattern>
            <radialGradient id="glow" r="0.5">
              <stop offset="0%" stopColor="#ff3b3b" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#ff3b3b" stopOpacity="0" />
            </radialGradient>
          </defs>
          <rect width={W} height={H} fill="#0a1019" />
          <rect width={W} height={H} fill="url(#grid)" />

          {/* 광주 경계(개략) */}
          <polygon points={pts(GWANGJU_OUTLINE)} fill="#0e1826" stroke="#2a3a52" strokeWidth="2" strokeDasharray="10 6" />
          <text x={P({ lat: 35.25, lng: 126.8 }).x} y={P({ lat: 35.25, lng: 126.8 }).y} fill="#3d5170" fontSize="15" fontWeight="700">
            옛 광주광역시 권역 (경계 개략)
          </text>
          {PLACE_LABELS.map((l) => {
            const p = P(l.at);
            return (
              <text key={l.name} x={p.x} y={p.y} fill="#3b4c66" fontSize={l.big ? 15 : 14} fontWeight={600} textAnchor="middle">
                {l.name}
              </text>
            );
          })}

          {/* 혼잡 DB */}
          {/* 관제권 (승인 필요 — 회피 대상 아님) */}
          {controlZones.map((z) => {
            const c = P(z.center);
            return (
              <g key={z.id}>
                <circle cx={c.x} cy={c.y} r={z.radiusKm * S} fill="#facc15" fillOpacity="0.03" stroke="#facc15" strokeOpacity="0.55" strokeWidth="1.5" strokeDasharray="10 7" />
                <text x={c.x} y={c.y - z.radiusKm * S + 18} fill="#e8c547" fontSize="12" textAnchor="middle" fontWeight={600}>
                  {z.name} — 승인·관제탑 협의 필요
                </text>
              </g>
            );
          })}

          {hotspots.map((h) => {
            const c = P(h.position);
            const on = activeIds.has(h.id);
            const color = h.kind === "불법주정차다발" ? "#f59e0b" : "#f97316";
            const R = 0.45 * S;
            return (
              <g key={h.id} opacity={on ? 1 : 0.35}>
                <circle cx={c.x} cy={c.y} r={R} fill={color} fillOpacity={on ? 0.14 : 0.06} stroke={color} strokeOpacity={0.6} strokeDasharray="4 4" />
                {on && (
                  <text x={c.x} y={c.y - R - 5} fill={color} fontSize="12" textAnchor="middle" fontWeight={600}>
                    {h.kind === "불법주정차다발" ? "🅿 주정차 다발" : "⛔ 상습 정체"}
                  </text>
                )}
              </g>
            );
          })}

          {/* 비행금지구역 */}
          {zones.map((z) => {
            const ps = z.polygon.map(P);
            const cx = ps.reduce((s, p) => s + p.x, 0) / ps.length;
            const cy = ps.reduce((s, p) => s + p.y, 0) / ps.length;
            return (
              <g key={z.id}>
                <polygon points={pts(z.polygon)} fill="#ff3b3b" fillOpacity="0.16" stroke="#ff3b3b" strokeOpacity="0.8" strokeWidth="2" strokeDasharray="6 4" />
                <text x={cx} y={cy - 4} fill="#ff8080" fontSize="13" textAnchor="middle" fontWeight={700}>
                  {z.name}
                </text>
                <text x={cx} y={cy + 13} fill="#ff8080" fontSize="11" textAnchor="middle" opacity={0.85}>
                  회피구역 (DB 자동 배제)
                </text>
              </g>
            );
          })}

          {/* 드론 거점 */}
          {bases.map((b) => {
            const p = P(b.position);
            return (
              <g key={b.id} opacity={0.75}>
                <rect x={p.x - 6} y={p.y - 6} width="12" height="12" rx="2" fill="#0b2a33" stroke="#22d3ee" strokeWidth="1.5" />
                <text x={p.x + 10} y={p.y + 4} fill="#5fb6c6" fontSize="11">
                  {b.name}
                </text>
              </g>
            );
          })}

          {/* 소방차 도로 경로 */}
          {truckPts.slice(1).map((p, k) => {
            const a = P(truckPts[k]);
            const b = P(p);
            const cls = speedClass(scenario.truckRoute[k].speedKmh);
            const color = cls === "정체" ? "#ef4444" : cls === "서행" ? "#f59e0b" : "#4b5d78";
            const inCluster = clusterSegs.has(k);
            return (
              <line
                key={k}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                stroke={color}
                strokeWidth={inCluster ? 7 : 5}
                strokeLinecap="round"
                className={cls !== "원활" && started ? "flow-dash" : undefined}
                opacity={0.85}
              >
                <title>{`${scenario.truckRoute[k].label ?? ""} — ${scenario.truckRoute[k].speedKmh}km/h (${cls})`}</title>
              </line>
            );
          })}
          <polyline points={pts(traveled)} fill="none" stroke="#fb923c" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />

          {/* 드론: 직선(차단) + 계획 경로 + 진행 */}
          {launch &&
            plan.drones.map((d) => {
              const f = d.flight;
              const a = P(f.path[0]);
              const b = P(f.path[f.path.length - 1]);
              const pos = droneAt(d, simTime);
              const dp = P(pos);
              const flying = simTime >= d.launchSec;
              const scanning = simTime >= d.broadcastSec;
              const flown = (() => {
                const out: LatLng[] = [];
                for (let k = 0; k < d.points.length; k++) {
                  if (d.times[k] <= simTime) out.push(d.points[k]);
                  else break;
                }
                out.push(pos);
                return out;
              })();
              const focus = sim.focusDrone === d.assignment.droneId;
              return (
                <g key={d.assignment.droneId}>
                  {f.blockedBy.length > 0 && (
                    <g opacity={0.8}>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#9aa7b8" strokeWidth="1.5" strokeDasharray="3 5" />
                      <g transform={`translate(${(a.x + b.x) / 2},${(a.y + b.y) / 2})`}>
                        <circle r="9" fill="#2a0f12" stroke="#ff3b3b" />
                        <path d="M-4,-4 L4,4 M4,-4 L-4,4" stroke="#ff3b3b" strokeWidth="2" />
                        <text x="12" y="4" fill="#ff9a9a" fontSize="11">
                          직선 경로 금지구역 침범
                        </text>
                      </g>
                    </g>
                  )}
                  <polyline points={pts(d.points.slice(1))} fill="none" stroke="#22d3ee" strokeOpacity="0.45" strokeWidth="2.5" strokeDasharray="7 5" />
                  {flying && <polyline points={pts(flown)} fill="none" stroke="#22d3ee" strokeWidth="3" strokeLinejoin="round" />}
                  {flying && (
                    <g transform={`translate(${dp.x},${dp.y})`} onClick={() => sim.setFocusDrone(d.assignment.droneId)} style={{ cursor: "pointer" }}>
                      {scanning && <circle r="10" fill="none" stroke="#22d3ee" className="pulse-ring" />}
                      <circle r={focus ? 11 : 9} fill="#06303a" stroke="#22d3ee" strokeWidth={focus ? 2.5 : 1.5} />
                      <path d="M0,-6 L5,5 L0,2 L-5,5 Z" fill="#22d3ee" />
                      <text x="13" y="-8" fill="#67e8f9" fontSize="12" fontWeight={700}>
                        {d.assignment.droneId}
                      </text>
                      {scanning && (
                        <text x="13" y="7" fill="#a5f3fc" fontSize="10">
                          LED·음성 송출
                        </text>
                      )}
                    </g>
                  )}
                </g>
              );
            })}

          {/* 탐지된 위반 차량 */}
          {violations.map((v) => {
            const p = P(v.position);
            const done = v.status === "submitted";
            return (
              <g key={v.id} transform={`translate(${p.x},${p.y})`} onClick={() => sim.setSelectedId(v.id)} style={{ cursor: "pointer" }}>
                <rect x="-7" y="-7" width="14" height="14" fill={done ? "#064e3b" : "#3b0d0d"} stroke={done ? "#34d399" : "#ff3b3b"} strokeWidth="2" />
                <text x="10" y="18" fill={done ? "#6ee7b7" : "#ff8a8a"} fontSize="11" fontWeight={600}>
                  {v.plate}
                </text>
              </g>
            );
          })}

          {/* 출발지·현장·소방차 */}
          <g transform={`translate(${station.x},${station.y})`}>
            <circle r="8" fill="#3a1d0b" stroke="#fb923c" strokeWidth="2" />
            <text x="-10" y="-12" fill="#fdba74" fontSize="12" textAnchor="end" fontWeight={600}>
              {scenario.station.name}
            </text>
          </g>
          <g transform={`translate(${incident.x},${incident.y})`}>
            <circle r="34" fill="url(#glow)" />
            {started && <circle r="8" fill="none" stroke="#ff3b3b" strokeWidth="2" className="pulse-ring" />}
            <text y="6" fontSize="20" textAnchor="middle">
              🔥
            </text>
            <text x="16" y="-14" fill="#ffb4b4" fontSize="12" fontWeight={700}>
              {scenario.incident.name}
            </text>
          </g>
          {started && (
            <g transform={`translate(${truckP.x},${truckP.y})`}>
              <circle r="12" fill="#1f1208" stroke="#fb923c" strokeWidth="2" />
              <text y="5" fontSize="14" textAnchor="middle">
                🚒
              </text>
            </g>
          )}
        </svg>

        {/* 범례 */}
        <div className="pointer-events-none absolute left-2 top-2 space-y-1 rounded-md bg-ink-950/80 p-2 text-[11px] text-ink-300">
          <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 border border-dashed border-alert bg-alert/20" /> 회피구역(경로 원천 배제)</div>
          <div className="flex items-center gap-2"><span className="inline-block h-2.5 w-4 rounded-full border border-dashed border-yellow-400" /> 관제권(승인 필요)</div>
          <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-4 bg-red-500" /> 정체 ≤15 · <span className="inline-block h-0.5 w-4 bg-amber-500" /> 서행 15~25 km/h</div>
          <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-4 bg-truck" /> 소방차 궤적</div>
          <div className="flex items-center gap-2"><span className="inline-block h-0.5 w-4 bg-drone" /> 선행 드론 궤적</div>
        </div>

        {/* ETA 비교 */}
        {started && (
          <div className="absolute bottom-2 left-2 right-2 flex flex-wrap gap-2 text-[11px]">
            <div className="rounded-md bg-ink-950/85 px-2.5 py-1.5">
              <div className="text-ink-400">🚒 소방차 현장 도착 예정</div>
              <div className="font-mono text-[13px] text-truck">
                T+{formatClock(plan.truck.totalSec)} <span className="text-ink-400">(평시 {formatClock(decision.normalSec)})</span>
              </div>
            </div>
            {launch &&
              plan.drones.map((d) => (
                <div key={d.assignment.droneId} className="rounded-md bg-ink-950/85 px-2.5 py-1.5">
                  <div className="text-ink-400">🚁 {d.assignment.droneId} → {d.assignment.cluster.hotspots[0]?.name ?? d.assignment.cluster.label}</div>
                  <div className="font-mono text-[13px] text-drone">
                    T+{formatClock(d.scanStartSec)} <span className="text-ok">소방차보다 {formatClock(d.leadSec)} 선행</span>
                  </div>
                </div>
              ))}
            {launch === false && (
              <div className="rounded-md bg-ink-950/85 px-2.5 py-1.5 text-ink-300">드론 미투입 — 소방차 단독 출동</div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
