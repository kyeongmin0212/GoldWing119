"use client";

// 실제 지도(OpenStreetMap, Leaflet) 위에 출동 상황을 그린다 — 키·가입 없음.
// 관제권(점선 원), 회피구역, 혼잡 지점, 소통 등급별 소방차 경로, 드론 권장 경로·실제 궤적, 소방차·드론·탐지 차량 표시.
// 지도 타일을 6초 안에 하나도 못 받으면 onFail 로 알려 개략도(SchematicMap)로 바꾼다.

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { ROAD_GEOMETRY } from "@/data/roadGeometry";
import { distLatLng, formatClock, speedClass, truckAt } from "@/lib/geo";
import { droneAt } from "@/lib/simulation";
import type { SimView } from "@/lib/simView";
import type { LatLng } from "@/types/drone";

type LMod = typeof import("leaflet");

const C = {
  avoid: "#c8102e",
  control: "#b45309",
  slow: "#d97706",
  jam: "#c8102e",
  road: "#6b7280",
  truck: "#c2410c",
  drone: "#1d4ed8",
  base: "#1f3a68",
  ok: "#2f7d32",
};

const ll = (p: LatLng): [number, number] => [p.lat, p.lng];
type Pt = [number, number];
const dKm = (a: Pt, b: Pt) => distLatLng({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] });

/** 실제 도로 선 위에서 비율(0~1)로 위치·부분 선을 구하는 도구 */
function roadTools(line: Pt[]) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + dKm(line[i - 1], line[i]));
  const total = cum[cum.length - 1] || 1;
  const at = (f: number): Pt => {
    const d = Math.max(0, Math.min(1, f)) * total;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = (d - cum[i - 1]) / seg;
    return [line[i - 1][0] + (line[i][0] - line[i - 1][0]) * t, line[i - 1][1] + (line[i][1] - line[i - 1][1]) * t];
  };
  const sub = (f1: number, f2: number): Pt[] => {
    const a = Math.max(0, f1) * total;
    const b = Math.min(1, f2) * total;
    const out: Pt[] = [at(f1)];
    for (let i = 0; i < line.length; i++) if (cum[i] > a && cum[i] < b) out.push(line[i]);
    out.push(at(f2));
    return out;
  };
  /** 점에서 가장 가까운 선 위 위치(비율). from 이후 인덱스에서만 찾아 순서를 지킨다 */
  const nearest = (p: Pt, from = 0): { f: number; idx: number; pt: Pt } => {
    let best = from;
    for (let i = from; i < line.length; i++) if (dKm(line[i], p) < dKm(line[best], p)) best = i;
    return { f: cum[best] / total, idx: best, pt: line[best] };
  };
  return { at, sub, nearest, total };
}
const label = (text: string, color: string, extra = "") =>
  `<span class="gjw-label" style="color:${color};${extra}">${text}</span>`;

const DRONE_SVG = (active: boolean) =>
  `<svg width="26" height="26" viewBox="-13 -13 26 26"><circle r="12" fill="#fff" stroke="${C.drone}" stroke-width="${active ? 2.6 : 1.6}"/><path d="M-5,-5 L5,5 M5,-5 L-5,5" stroke="${C.drone}" stroke-width="1.6"/>${[
    [-5, -5],
    [5, -5],
    [-5, 5],
    [5, 5],
  ]
    .map(([a, b]) => `<circle cx="${a}" cy="${b}" r="2.6" fill="none" stroke="${C.drone}" stroke-width="1.4"/>`)
    .join("")}</svg>`;
const TRUCK_SVG = `<svg width="28" height="22" viewBox="0 0 28 22"><rect x="1" y="1" width="26" height="20" rx="3" fill="#fff" stroke="${C.truck}" stroke-width="2"/><path d="M5 6h10v8H5zM15 9h4l3 3v2h-7z" fill="${C.truck}"/><circle cx="8" cy="16.5" r="2" fill="${C.truck}"/><circle cx="19" cy="16.5" r="2" fill="${C.truck}"/></svg>`;
const FIRE_SVG = `<svg width="24" height="24" viewBox="-12 -12 24 24"><circle r="10" fill="#fff" stroke="${C.avoid}" stroke-width="2.5"/><path d="M0,-6 C3.5,-1.5 5,1 5,3.5 A5,5 0 0 1 -5,3.5 C-5,1 -2.5,-1.5 0,-6 Z" fill="${C.avoid}"/></svg>`;

export default function LeafletMap({ sim, compact = false, onFail }: { sim: SimView; compact?: boolean; onFail?: () => void }) {
  const { scenario, plan, zones, controlZones, hotspots, bases, decision, simTime, violations, launch, status } = sim;
  const elRef = useRef<HTMLDivElement>(null);
  const LRef = useRef<LMod | null>(null);
  const mapRef = useRef<Leaflet.Map | null>(null);
  const staticRef = useRef<Leaflet.LayerGroup | null>(null);
  const dynRef = useRef<{
    group: Leaflet.LayerGroup | null;
    truck: Leaflet.Marker | null;
    traveled: Leaflet.Polyline | null;
    drones: Map<string, { marker: Leaflet.Marker; flown: Leaflet.Polyline; key: string }>;
    viol: Map<string, { marker: Leaflet.Marker; key: string }>;
  }>({ group: null, truck: null, traveled: null, drones: new Map(), viol: new Map() });
  const [ready, setReady] = useState(false);
  const simRef = useRef(sim);
  simRef.current = sim;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  // 시나리오의 실제 도로 선과, 시뮬레이션 구간 경계(경유점)를 그 선 위 비율로 대응
  const roadRef = useRef<{ mode: string; line: Pt[]; tools: ReturnType<typeof roadTools>; fr: number[] } | null>(null);
  if (!roadRef.current || roadRef.current.mode !== sim.mode) {
    const line = ROAD_GEOMETRY[sim.mode].line;
    const tools = roadTools(line);
    const fr: number[] = [0];
    let idx = 0;
    for (let v = 1; v < plan.truck.points.length - 1; v++) {
      const n = tools.nearest(ll(plan.truck.points[v]), idx);
      idx = n.idx;
      fr.push(Math.max(fr[fr.length - 1], n.f));
    }
    fr.push(1);
    roadRef.current = { mode: sim.mode, line, tools, fr };
  }

  // 1) 지도 만들기 (한 번)
  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    import("leaflet").then((L) => {
      if (cancelled || !elRef.current) return;
      LRef.current = L;
      map = L.map(elRef.current, { zoomControl: !compact, attributionControl: true, scrollWheelZoom: true });
      map.attributionControl.setPrefix(false);
      let loaded = 0;
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '지도 &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> 기여자',
      });
      tiles.on("tileload", () => {
        loaded += 1;
      });
      tiles.addTo(map);
      timer = setTimeout(() => {
        if (!cancelled && loaded === 0) onFailRef.current?.();
      }, 6000);
      staticRef.current = L.layerGroup().addTo(map);
      dynRef.current.group = L.layerGroup().addTo(map);
      map.setView([35.13, 126.84], 12);
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      map?.remove();
      mapRef.current = null;
    };
  }, [compact]);

  // 2) 시나리오가 바뀔 때만 다시 그리는 층 + 화면 맞추기
  useEffect(() => {
    const L = LRef.current;
    const map = mapRef.current;
    const g = staticRef.current;
    const dyn = dynRef.current;
    if (!ready || !L || !map || !g || !dyn.group) return;
    g.clearLayers();
    dyn.group.clearLayers();
    dyn.truck = null;
    dyn.traveled = null;
    dyn.drones.clear();
    dyn.viol.clear();

    const icon = (html: string, size: [number, number], anchor: [number, number]) => L.divIcon({ html, className: "gjw-icon", iconSize: size, iconAnchor: anchor });
    const tip = (text: string) => ({ permanent: true, direction: "center" as const, className: "gjw-zone-label", interactive: false });

    // 관제권 — 승인 대상 (회피 대상 아님)
    controlZones.forEach((z) => {
      L.circle(ll(z.center), { radius: z.radiusKm * 1000, color: C.control, weight: 1.5, dashArray: "8 6", fill: false, interactive: false }).addTo(g);
      if (!compact)
        L.marker([z.center.lat + (z.radiusKm - 0.6) / 111, z.center.lng], {
          icon: icon(label(`${z.name} · 비행 승인 대상`, C.control, "transform:translateX(-50%)"), [1, 1], [0, 0]),
          interactive: false,
        }).addTo(g);
    });

    // 회피구역 — 권장 경로에서 원천 배제
    zones.forEach((z) => {
      const poly = L.polygon(z.polygon.map(ll), { color: C.avoid, weight: 1.5, dashArray: "4 3", fillColor: C.avoid, fillOpacity: 0.16, interactive: false }).addTo(g);
      if (!compact) poly.bindTooltip(z.name, tip(z.name));
    });

    // 혼잡 지점
    const activeIds = new Set(decision.matches.filter((m) => m.active).map((m) => m.hotspot.id));
    hotspots.forEach((h) => {
      const on = activeIds.has(h.id);
      if (!on && compact) return;
      const color = h.kind === "불법주정차다발" ? C.slow : C.jam;
      L.circle(ll(h.position), { radius: 450, color, weight: 1, dashArray: "3 3", fillColor: color, fillOpacity: on ? 0.12 : 0.04, opacity: on ? 0.9 : 0.35, interactive: false }).addTo(g);
      if (on && !compact)
        L.marker([h.position.lat + 0.0052, h.position.lng], {
          icon: icon(label(h.kind === "불법주정차다발" ? "주정차 다발" : "상습 정체", color, "transform:translateX(-50%)"), [1, 1], [0, 0]),
          interactive: false,
        }).addTo(g);
    });

    // 드론 거점
    if (!compact)
      bases.forEach((b) => {
        L.marker(ll(b.position), {
          icon: icon(`<span style="display:inline-block;width:10px;height:10px;background:#fff;border:2px solid ${C.base}"></span>${label(b.name, C.base, "margin-left:4px")}`, [12, 12], [6, 6]),
          interactive: false,
        }).addTo(g);
      });

    // 소방차 경로 — 소통 등급 색
    const clusterSegs = new Set<number>();
    decision.clusters.forEach((c) => {
      for (let k = c.firstSeg; k <= c.lastSeg; k++) clusterSegs.add(k);
    });
    const road = roadRef.current!;
    scenario.truckRoute.forEach((seg, k) => {
      const cls = speedClass(seg.speedKmh);
      const color = cls === "정체" ? C.jam : cls === "서행" ? C.slow : C.road;
      L.polyline(road.tools.sub(road.fr[k], road.fr[k + 1]), { color, weight: clusterSegs.has(k) ? 8 : 6, opacity: 0.85 })
        .bindTooltip(`${seg.label ?? ""} — ${seg.speedKmh}km/h (${cls})`, { sticky: true })
        .addTo(g);
    });

    // 드론 권장 경로
    if (launch)
      plan.drones.forEach((d) => {
        const f = d.flight;
        if (f.blockedBy.length && !compact)
          L.polyline([ll(f.path[0]), ll(f.path[f.path.length - 1])], { color: "#6b7280", weight: 1.5, dashArray: "2 6", interactive: false }).addTo(g);
        L.polyline(d.points.slice(1).map(ll), { color: C.drone, weight: 3, dashArray: "7 6", opacity: 0.55, interactive: false }).addTo(g);
      });

    // 출발 소방서 · 현장
    L.marker(ll(scenario.station.position), {
      icon: icon(`<span style="display:inline-block;width:14px;height:14px;background:${C.truck}"></span>${compact ? "" : label(scenario.station.name, C.truck, "margin-left:4px")}`, [14, 14], [7, 7]),
      interactive: false,
    }).addTo(g);
    L.marker(ll(scenario.incident.position), {
      icon: icon(`${FIRE_SVG}${label(scenario.incident.name, C.avoid, "margin-left:4px")}`, [24, 24], [12, 12]),
      interactive: false,
      zIndexOffset: 500,
    }).addTo(g);

    // 화면 맞추기: 경로 + 현장 + (투입 시) 드론 경로
    const pts: [number, number][] = [...road.line, ll(scenario.incident.position)];
    if (launch) plan.drones.forEach((d) => d.points.forEach((p) => pts.push(ll(p))));
    map.fitBounds(L.latLngBounds(pts), { padding: compact ? [18, 18] : [40, 40], maxZoom: 15 });
  }, [ready, scenario, plan, decision, launch, zones, controlZones, hotspots, bases, compact]);

  // 3) 매 프레임 바뀌는 층: 소방차·지나온 길·드론·탐지 차량
  useEffect(() => {
    const L = LRef.current;
    const dyn = dynRef.current;
    if (!ready || !L || !dyn.group) return;
    const g = dyn.group;
    const icon = (html: string, size: [number, number], anchor: [number, number]) => L.divIcon({ html, className: "gjw-icon", iconSize: size, iconAnchor: anchor });
    const started = status !== "idle";

    // 소방차
    const road = roadRef.current!;
    const truck = truckAt(plan.truck, simTime);
    const k = truck.segIndex;
    const t0 = plan.truck.times[k];
    const t1 = plan.truck.times[k + 1] ?? t0;
    const tf = t1 > t0 ? Math.max(0, Math.min(1, (simTime - t0) / (t1 - t0))) : 1;
    const f = simTime >= plan.truck.totalSec ? 1 : road.fr[k] + (road.fr[k + 1] - road.fr[k]) * tf;
    const truckPt = road.tools.at(f);
    const traveled = road.tools.sub(0, f);
    if (started) {
      if (!dyn.traveled) dyn.traveled = L.polyline(traveled, { color: C.truck, weight: 4, opacity: 0.95, interactive: false }).addTo(g);
      else dyn.traveled.setLatLngs(traveled);
      if (!dyn.truck) dyn.truck = L.marker(truckPt, { icon: icon(TRUCK_SVG, [28, 22], [14, 11]), interactive: false, zIndexOffset: 800 }).addTo(g);
      else dyn.truck.setLatLng(truckPt);
    }

    // 드론
    if (launch)
      plan.drones.forEach((d) => {
        const id = d.assignment.droneId;
        if (simTime < d.launchSec) return;
        const pos = droneAt(d, simTime);
        const flown: [number, number][] = [];
        for (let k = 0; k < d.points.length; k++) {
          if (d.times[k] <= simTime) flown.push(ll(d.points[k]));
          else break;
        }
        flown.push(ll(pos));
        const focus = simRef.current.focusDrone === id;
        const broadcasting = simTime >= d.broadcastSec;
        const key = `${focus}|${broadcasting}`;
        const html = `<div style="position:relative">${DRONE_SVG(focus)}<span style="position:absolute;left:28px;top:-2px">${label(id, C.drone)}${broadcasting ? `<br>${label("길터주기 방송 중", C.avoid, "font-size:10.5px")}` : ""}</span></div>`;
        const cur = dyn.drones.get(id);
        if (!cur) {
          const marker = L.marker(ll(pos), { icon: icon(html, [26, 26], [13, 13]), zIndexOffset: 900 }).addTo(g);
          marker.on("click", () => simRef.current.setFocusDrone(id));
          const fl = L.polyline(flown, { color: C.drone, weight: 3.5, interactive: false }).addTo(g);
          dyn.drones.set(id, { marker, flown: fl, key });
        } else {
          cur.marker.setLatLng(ll(pos));
          cur.flown.setLatLngs(flown);
          if (cur.key !== key) {
            cur.marker.setIcon(icon(html, [26, 26], [13, 13]));
            cur.key = key;
          }
        }
      });

    // 탐지 차량
    violations.forEach((v) => {
      const done = v.status === "submitted";
      const color = done ? C.ok : C.avoid;
      const key = `${v.status}`;
      const html = `<span style="display:inline-block;width:12px;height:12px;background:#fff;border:2.5px solid ${color}"></span>${label(v.plate, color, "margin-left:3px")}`;
      const cur = dyn.viol.get(v.id);
      if (!cur) {
        // 진로방해 차량은 소방차가 지나는 실제 도로 위 가장 가까운 지점에 표시
        const marker = L.marker(road.tools.nearest(ll(v.position)).pt, { icon: icon(html, [14, 14], [7, 7]), zIndexOffset: 700 }).addTo(g);
        marker.on("click", () => simRef.current.setSelectedId(v.id));
        dyn.viol.set(v.id, { marker, key });
      } else if (cur.key !== key) {
        cur.marker.setIcon(icon(html, [14, 14], [7, 7]));
        cur.key = key;
      }
    });
  });

  const started = status !== "idle";
  return (
    <div className="relative h-full w-full">
      <div ref={elRef} className="absolute inset-0" aria-label="출동 상황 지도" />

      {!compact && (
        <div className="pointer-events-none absolute left-12 top-2 z-[1000] space-y-1 border border-line bg-white/95 p-2 text-[11px] text-muted">
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-4 border border-dashed border-fire bg-fire/15" /> 회피구역 (권장 경로에서 배제)
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-4 rounded-full border border-dashed border-slow" /> 관제권 (비행 승인 대상)
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-1 w-4 bg-fire" /> 정체 ≤15 <span className="ml-1 inline-block h-1 w-4 bg-amber-600" /> 서행 15~25 km/h
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 bg-truck" /> 소방차 <span className="ml-1 inline-block h-0.5 w-4 bg-drone" /> 드론 (원격 조종자)
          </div>
        </div>
      )}

      {!compact && started && (
        <div className="absolute bottom-6 left-2 right-2 z-[1000] flex flex-wrap gap-2 text-[12px]">
          <div className="border border-line bg-white/95 px-2.5 py-1.5">
            <span className="text-muted">소방차 현장 도착 예정 </span>
            <b className="font-mono">T+{formatClock(plan.truck.totalSec)}</b>
            <span className="text-faint"> (평시 {formatClock(decision.normalSec)})</span>
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
