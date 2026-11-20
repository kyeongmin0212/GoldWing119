"use client";

// 실제 지도(OpenStreetMap, Leaflet) 위에 출동 상황을 그린다 — 키·가입 없음.
// 혼잡 지점, 소통 등급별 소방차 경로, 드론 권장 경로·실제 궤적, 소방차·드론·탐지 차량, 전방 차단·우회로 표시.
// 비행 제한 구역(관제권·회피구역) 표시는 추후 보완.
// 지도 타일을 6초 안에 하나도 못 받으면 onFail 로 알려 개략도(SchematicMap)로 바꾼다.

import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { formatClock, speedClass, truckAt } from "@/lib/geo";
import { maskPlate } from "@/lib/plate";
import { scenarioRoute } from "@/lib/road";
import { droneAt } from "@/lib/simulation";
import type { SimView } from "@/lib/simView";
import type { LatLng } from "@/types/drone";

type LMod = typeof import("leaflet");

const C = {
  avoid: "#c8102e",
  control: "#b45309",
  slow: "#eab308", // 노랑 — 소방차(#c2410c 주황 갈색)와 헷갈리지 않게
  jam: "#c8102e",
  road: "#6b7280",
  truck: "#c2410c",
  drone: "#1d4ed8",
  base: "#1f3a68",
  ok: "#2f7d32",
};

const ll = (p: LatLng): [number, number] => [p.lat, p.lng];
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
  const { scenario, plan, hotspots, bases, decision, simTime, violations, launch, status, routeChoice } = sim;
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
    block: Leaflet.LayerGroup | null;
    blockKey: string;
  }>({ group: null, truck: null, traveled: null, drones: new Map(), viol: new Map(), block: null, blockKey: "" });
  const [ready, setReady] = useState(false);
  const simRef = useRef(sim);
  simRef.current = sim;
  const onFailRef = useRef(onFail);
  onFailRef.current = onFail;

  // 지금 소방차가 가는 경로(기존 또는 우회)의 실제 도로 선과 구간 경계 비율 — 시뮬레이션과 같은 값(plan.route)
  const road = plan.route.road;

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
    dyn.block = null;
    dyn.blockKey = "";

    const icon = (html: string, size: [number, number], anchor: [number, number]) => L.divIcon({ html, className: "gjw-icon", iconSize: size, iconAnchor: anchor });

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
        const atStation = Math.abs(b.position.lat - scenario.station.position.lat) + Math.abs(b.position.lng - scenario.station.position.lng) < 0.005;
        L.marker(ll(b.position), {
          icon: icon(`<span style="display:inline-block;width:10px;height:10px;background:#fff;border:2px solid ${C.base}"></span>${atStation ? "" : label(b.name, C.base, "margin-left:4px")}`, [12, 12], [6, 6]),
          interactive: false,
        }).addTo(g);
      });

    // 소방차 경로 — 소통 등급 색
    const clusterSegs = new Set<number>();
    decision.clusters.forEach((c) => {
      for (let k = c.firstSeg; k <= c.lastSeg; k++) clusterSegs.add(k);
    });
    plan.route.segs.forEach((seg, k) => {
      const cls = speedClass(seg.speedKmh);
      const color = cls === "정체" ? C.jam : cls === "서행" ? C.slow : C.road;
      L.polyline(road.tools.sub(road.fr[k], road.fr[k + 1]), { color, weight: clusterSegs.has(k) ? 8 : 6, opacity: 0.85 })
        .bindTooltip(`${seg.label ?? ""} — ${seg.speedKmh}km/h (${cls})`, { sticky: true })
        .addTo(g);
    });

    // 드론 권장 경로
    if (launch)
      plan.drones.forEach((d) => {
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
    // 드론은 정찰 구간만 화면에 맞춘다 (거점 → 경로 합류 비행까지 넣으면 화면이 공항 쪽으로 넓어짐)
    if (launch) plan.drones.forEach((d) => d.points.forEach((p, i) => { if (d.times[i] >= d.scanStartSec) pts.push(ll(p)); }));
    map.fitBounds(L.latLngBounds(pts), { padding: compact ? [18, 18] : [40, 40], maxZoom: 15 });
  }, [ready, scenario, plan, decision, launch, hotspots, bases, compact]);

  // 3) 매 프레임 바뀌는 층: 소방차·지나온 길·드론·탐지 차량
  useEffect(() => {
    const L = LRef.current;
    const dyn = dynRef.current;
    if (!ready || !L || !dyn.group) return;
    const g = dyn.group;
    const icon = (html: string, size: [number, number], anchor: [number, number]) => L.divIcon({ html, className: "gjw-icon", iconSize: size, iconAnchor: anchor });
    const started = status !== "idle";

    // 소방차
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
        const key = `${focus}`;
        const html = `<div style="position:relative">${DRONE_SVG(focus)}<span style="position:absolute;left:28px;top:-2px">${label(id, C.drone)}</span></div>`;
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

    // 전방 차단(정찰 드론 발견) · 권장 우회로
    const blk = plan.blockage;
    const bKey = blk && started && simTime >= blk.atSec ? (routeChoice ?? "pending") : "";
    if (dyn.blockKey !== bKey) {
      dyn.block?.remove();
      dyn.block = null;
      dyn.blockKey = bKey;
      const det = scenario.blockage?.detour;
      if (blk && bKey && det) {
        const lg = L.layerGroup().addTo(g);
        const from = det.fromSeg;
        const rejoin = from + det.segments.length;
        if (routeChoice !== "detour") {
          const dr = scenarioRoute(scenario, "detour").road;
          L.polyline(dr.tools.sub(dr.fr[from], dr.fr[rejoin]), { color: C.ok, weight: 5, dashArray: "8 6", opacity: 0.9, interactive: false }).addTo(lg);
          if (!compact && routeChoice === null) {
            const mid = dr.tools.at((dr.fr[from] + dr.fr[rejoin]) / 2);
            L.marker(mid, { icon: icon(label("권장 우회로", C.ok, "transform:translate(-50%,-140%)"), [1, 1], [0, 0]), interactive: false }).addTo(lg);
          }
        } else {
          const br = scenarioRoute(scenario, "base").road;
          L.polyline(br.tools.sub(br.fr[from], br.fr[rejoin]), { color: "#9ca3af", weight: 5, dashArray: "3 7", opacity: 0.9, interactive: false }).addTo(lg);
        }
        L.marker(ll(blk.position), {
          icon: icon(
            `<svg width="22" height="22" viewBox="-11 -11 22 22"><rect x="-10" y="-10" width="20" height="20" fill="#fff" stroke="${C.avoid}" stroke-width="2.5"/><path d="M-5,-5 L5,5 M5,-5 L-5,5" stroke="${C.avoid}" stroke-width="2.6"/></svg>${compact ? "" : label(blk.short, C.avoid, "margin-left:4px")}`,
            [22, 22],
            [11, 11],
          ),
          zIndexOffset: 800,
          interactive: false,
        }).addTo(lg);
        dyn.block = lg;
      }
    }

    // 탐지 차량
    violations.forEach((v) => {
      const done = v.status === "reviewed";
      const color = done ? C.ok : C.avoid;
      const key = `${v.status}`;
      const html = `<span style="display:inline-block;width:12px;height:12px;background:#fff;border:2.5px solid ${color}"></span>${label(maskPlate(v.plate), color, "margin-left:3px")}`;
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
            <span className="inline-block h-1 w-4 bg-fire" /> 정체 15 km/h 이하 <span className="ml-1 inline-block h-1 w-4 bg-yellow-500" /> 서행 15 초과~25 km/h 미만
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block h-0.5 w-4 bg-truck" /> 소방차 <span className="ml-1 inline-block h-0.5 w-4 bg-drone" /> 드론 정찰 경로 (원격 조종자가 소방차 앞길을 미리 확인)
          </div>
          {plan.blockage && (
            <div className="flex items-center gap-2">
              <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-ok" /> 권장 우회로 (조종자가 막힌 곳을 확인하면 안내)
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="inline-block h-3 w-3 rounded-full border border-dashed border-fire bg-fire/10" /> 혼잡 지점 반경 450 m (빨강 상습 정체 · 노랑 주정차 다발)
          </div>
          <div className="text-faint">비행 제한 구역은 아직 지도에 반영하지 않음 (추후 보완)</div>
        </div>
      )}

      {!compact && started && (
        <div className="absolute bottom-6 left-2 right-2 z-[1000] flex flex-wrap gap-2 text-[12px]">
          <div className="border border-line bg-white/95 px-2.5 py-1.5">
            <span className="text-muted">소방차 현장 도착 예정 </span>
            <b className="font-mono">T+{formatClock(plan.truck.totalSec)}</b>
            <span className="text-faint"> {status === "rerouting" ? "(경로 선택 대기 · 사고 반영 전)" : `(평시 ${formatClock(decision.normalSec)})`}</span>
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
