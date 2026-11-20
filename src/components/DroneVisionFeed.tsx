"use client";

// 선행 드론 실시간 영상(하향 카메라) 시뮬레이터 — 바운딩 박스, 번호판 OCR, 길터주기 방송 상태
// 비행 중에는 실제 지도(OpenStreetMap)를 드론 위치·진행 방향에 맞춰 내려다보는 가상 영상으로 보여 주고,
// 그 위에 소방차 경로를 따라 움직이는 가상 차량·진로방해 차량·소방차·사고 현장을 그린다(Canvas).
// 지도 타일을 못 받으면(오프라인) 합성 도로 화면으로 대체한다.
// 상황실 콘솔과 소방차 태블릿(보기 전용, 큰 글씨)이 같이 쓴다. 드론은 상황실 원격 조종자(사람)가 조종한다.

import { useEffect, useMemo, useRef } from "react";
import "leaflet/dist/leaflet.css";
import type * as Leaflet from "leaflet";
import { UserRound, Video } from "lucide-react";
import { formatClock, formatLatLng, truckAt, type TruckTimeline } from "@/lib/geo";
import type { ScenarioRoad } from "@/lib/road";
import { droneAt, type DroneSim } from "@/lib/simulation";
import type { SimView } from "@/lib/simView";
import type { LatLng, RoadSegment, ViolationRecord, ViolationSample } from "@/types/drone";

type Phase = "standby" | "nodrone" | "prep" | "transit" | "scan";
type LMod = typeof import("leaflet");

interface FrameState {
  phase: Phase;
  drone: DroneSim | null;
  simTime: number;
  speedMult: number;
  lockTarget: (ViolationSample & { record?: ViolationRecord }) | null;
  approach: { v: ViolationSample; ratio: number } | null;
  role: string;
  /** 지도 영상용: 지금 소방차 경로의 도로 선 */
  road: ScenarioRoad;
  roadPts: LatLng[];
  /** 도로 선 누적 거리(m) */
  cum: number[];
  segs: RoadSegment[];
  truck: TruckTimeline;
  truckOn: boolean;
  parked: { sample: ViolationSample; record?: ViolationRecord }[];
  blockage: LatLng | null;
  /** 길터주기 방송 중 — 같은 방향 차량이 우측으로 비켜 정지 */
  yielding: boolean;
}

function rand(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

const R_EARTH = 6371000;
/** 두 점 사이 거리(m) — 짧은 거리용 근사 */
function meters(a: LatLng, b: LatLng): number {
  const x = ((b.lng - a.lng) * Math.PI * R_EARTH * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))) / 180;
  const y = ((b.lat - a.lat) * Math.PI * R_EARTH) / 180;
  return Math.hypot(x, y);
}
/** a → b 방위(라디안, 북쪽 0, 시계 방향) */
function bearing(a: LatLng, b: LatLng): number {
  return Math.atan2((b.lng - a.lng) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat);
}

const CAR_COLORS = ["#e5e7eb", "#94a3b8", "#334155", "#1e3a8a", "#7f1d1d", "#f8fafc", "#0f172a", "#78716c"];

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x + 3, y + 4, w, h);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(5, w * 0.3));
  ctx.fill();
  ctx.fillStyle = "rgba(20,30,45,0.85)";
  ctx.fillRect(x + w * 0.15, y + h * 0.18, w * 0.7, h * 0.2);
  ctx.fillRect(x + w * 0.15, y + h * 0.68, w * 0.7, h * 0.14);
}

export default function DroneVisionFeed({
  sim,
  big = false,
}: {
  sim: SimView;
  /** 소방차 태블릿용 큰 글씨 */
  big?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<{ map: Leaflet.Map; loaded: number; activeSince: number; failed: boolean } | null>(null);
  const stateRef = useRef<FrameState | null>(null);
  const lockStartRef = useRef<{ id: string; at: number } | null>(null);

  const { plan, simTime, status, launch, violations, speed } = sim;
  const drone = plan.drones.find((d) => d.assignment.droneId === sim.focusDrone) ?? plan.drones[plan.drones.length - 1] ?? null;

  let phase: Phase = "standby";
  if (status === "idle" || status === "awaiting") phase = "standby";
  else if (!launch || !drone) phase = "nodrone";
  else if (simTime < drone.launchSec + 30) phase = "prep";
  else if (simTime < drone.scanStartSec) phase = "transit";
  else phase = "scan";

  // 이 드론의 탐지 일정
  const myDet = drone ? plan.detections.filter((d) => d.droneId === drone.assignment.droneId) : [];
  let lockTarget: FrameState["lockTarget"] = null;
  let approach: FrameState["approach"] = null;
  if (phase === "scan") {
    for (let i = 0; i < myDet.length; i++) {
      const d = myDet[i];
      const next = myDet[i + 1];
      const v = sim.scenario.violations.find((x) => x.id === d.violationId)!;
      if (simTime >= d.atSec && (!next || simTime < next.atSec - 25)) {
        lockTarget = { ...v, record: violations.find((r) => r.id === v.id) };
      } else if (simTime < d.atSec && simTime >= d.atSec - 25) {
        approach = { v, ratio: (d.atSec - simTime) / 25 };
      }
    }
  }

  const road = plan.route.road;
  const roadData = useMemo(() => {
    const pts = road.line.map(([lat, lng]) => ({ lat, lng }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + meters(pts[i - 1], pts[i]));
    return { pts, cum };
  }, [road]);
  const myIds = new Set(myDet.map((d) => d.violationId));

  stateRef.current = {
    phase,
    drone,
    simTime,
    speedMult: speed,
    lockTarget,
    approach,
    role: drone?.assignment.role ?? "",
    road,
    roadPts: roadData.pts,
    cum: roadData.cum,
    segs: plan.route.segs,
    truck: plan.truck,
    truckOn: status !== "idle" && status !== "awaiting",
    parked: sim.scenario.violations.filter((v) => myIds.has(v.id)).map((v) => ({ sample: v, record: violations.find((r) => r.id === v.id) })),
    blockage: plan.blockage?.position ?? null,
    yielding: phase === "scan" && !!drone && simTime >= drone.broadcastSec,
  };

  // 지도(하향 영상 바탕) — 한 번 만들고 매 프레임 드론 위치로 옮긴다. 조작은 모두 끔.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const L: LMod = await import("leaflet");
      if (cancelled || !mapElRef.current) return;
      const map = L.map(mapElRef.current, {
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        scrollWheelZoom: false,
        doubleClickZoom: false,
        boxZoom: false,
        keyboard: false,
        touchZoom: false,
        fadeAnimation: false,
        zoomAnimation: false,
        markerZoomAnimation: false,
        inertia: false,
      }).setView([35.13, 126.9], 17);
      const m = { map, loaded: 0, activeSince: 0, failed: false };
      const layer = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, keepBuffer: 4, updateWhenIdle: false, updateInterval: 150 });
      layer.on("tileload", () => {
        m.loaded += 1;
      });
      layer.addTo(map);
      mapRef.current = m;
    })();
    return () => {
      cancelled = true;
      mapRef.current?.map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let scroll = 0;
    let last = performance.now();
    let heading = 0;
    let headingInit = false;
    let mapD = 0;
    let nearIdx = 0;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      canvas.width = Math.max(1, r.width * dpr);
      canvas.height = Math.max(1, r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
      // 회전해도 모서리가 비지 않도록 대각선 길이의 정사각형 지도
      const el = mapElRef.current;
      if (el) {
        mapD = Math.ceil(Math.hypot(r.width, r.height)) + 8;
        el.style.width = `${mapD}px`;
        el.style.height = `${mapD}px`;
        el.style.left = `${(r.width - mapD) / 2}px`;
        el.style.top = `${(r.height - mapD) / 2}px`;
        mapRef.current?.map.invalidateSize();
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    /** 바운딩 박스 + 번호판 OCR 라벨 (타이핑 효과) */
    const drawLock = (bx: number, by: number, bw: number, bh: number, sample: ViolationSample, record: ViolationRecord | undefined, now: number, boxed = true) => {
      if (boxed) {
      ctx.strokeStyle = "rgba(255,59,59,0.95)";
      ctx.lineWidth = 2.5;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.strokeStyle = "#ff3b3b";
      ctx.lineWidth = 3;
      const c = 10;
      [[bx, by, 1, 1], [bx + bw, by, -1, 1], [bx, by + bh, 1, -1], [bx + bw, by + bh, -1, -1]].forEach(([x, yy, sx, sy]) => {
        ctx.beginPath();
        ctx.moveTo(x, yy + sy * c);
        ctx.lineTo(x, yy);
        ctx.lineTo(x + sx * c, yy);
        ctx.stroke();
      });
      }
      const lk = lockStartRef.current;
      if (!lk || lk.id !== sample.id) lockStartRef.current = { id: sample.id, at: now };
      const elapsed = (now - (lockStartRef.current?.at ?? now)) / 1000;
      const plate = sample.plate;
      const shown = plate.slice(0, Math.min(plate.length, Math.floor(elapsed * 8)));
      const lx = !boxed ? bx : bx > 160 ? bx - 150 : bx + bw + 10;
      const ly = by;
      ctx.fillStyle = "rgba(127,29,29,0.92)";
      ctx.fillRect(lx, ly, 140, 58);
      ctx.fillStyle = "#fff";
      ctx.font = "bold 16px ui-monospace, Consolas, monospace";
      ctx.fillText(shown + (shown.length < plate.length ? "▌" : ""), lx + 8, ly + 21);
      ctx.font = "11px sans-serif";
      ctx.fillStyle = "#fecaca";
      ctx.fillText(`OCR ${(sample.confidence * 100).toFixed(0)}% · 가상 번호`, lx + 8, ly + 37);
      const stLabel =
        record?.status === "reviewed" ? "통보 초안 검토 완료" : record?.status === "pending" ? "통보 초안 검토 대기" : record?.status === "dismissed" ? "무시됨" : "통보 초안 작성 중";
      ctx.fillStyle = record?.status === "reviewed" ? "#6ee7b7" : "#fde68a";
      ctx.fillText(stLabel, lx + 8, ly + 51);
    };

    /** 실제 지도 위 하향 영상: 지도를 드론 위치·방향으로 옮기고 도로 위 가상 차량 등을 그린다 */
    const drawMapScene = (map: Leaflet.Map, mapEl: HTMLDivElement, st: FrameState, W: number, H: number, now: number) => {
      const d = st.drone!;
      const pos = droneAt(d, st.simTime);
      const ahead = droneAt(d, st.simTime + 8);
      if (meters(pos, ahead) > 3) {
        const target = bearing(pos, ahead);
        if (!headingInit) {
          heading = target;
          headingInit = true;
        } else {
          let diff = target - heading;
          while (diff > Math.PI) diff -= 2 * Math.PI;
          while (diff < -Math.PI) diff += 2 * Math.PI;
          heading += diff * 0.08;
        }
      }
      const zoom = st.phase === "transit" ? 16 : 18;
      map.setView([pos.lat, pos.lng], zoom, { animate: false });
      mapEl.style.transform = `rotate(${-heading}rad)`;
      const D = mapD || Math.hypot(W, H);
      const cosA = Math.cos(-heading);
      const sinA = Math.sin(-heading);
      const project = (p: LatLng) => {
        const c = map.latLngToContainerPoint([p.lat, p.lng]);
        const dx = c.x - D / 2;
        const dy = c.y - D / 2;
        return { x: W / 2 + dx * cosA - dy * sinA, y: H / 2 + dx * sinA + dy * cosA };
      };
      const mpp = (156543.03392 * Math.cos((pos.lat * Math.PI) / 180)) / 2 ** zoom; // m/px
      const pxm = 1 / mpp;
      const vis = 1.6; // 작게 보이는 차량을 조금 키워 그림
      ctx.clearRect(0, 0, W, H);

      // 도로 선 위 위치 도구
      const pts = st.roadPts;
      const cum = st.cum;
      const total = cum[cum.length - 1] || 1;
      const pointAt = (s: number): LatLng => {
        const x = Math.max(0, Math.min(total, s));
        let lo = 0;
        let hi = cum.length - 1;
        while (hi - lo > 1) {
          const mid = (lo + hi) >> 1;
          if (cum[mid] <= x) lo = mid;
          else hi = mid;
        }
        const t = (x - cum[lo]) / (cum[hi] - cum[lo] || 1);
        return { lat: pts[lo].lat + (pts[hi].lat - pts[lo].lat) * t, lng: pts[lo].lng + (pts[hi].lng - pts[lo].lng) * t };
      };
      const segAtIdx = (i: number) => {
        const idx = st.road.idx;
        for (let k = 0; k < idx.length - 1; k++) if (i < idx[k + 1]) return st.segs[k];
        return st.segs[st.segs.length - 1];
      };
      // 화면 위 도로 방향(단위 벡터)과 오른쪽 법선
      const frameAt = (s: number) => {
        const a = project(pointAt(s));
        const b = project(pointAt(s + 2));
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
        return { a, u, n: { x: -u.y, y: u.x } };
      };
      const drawAt = (x: number, y: number, ang: number, fn: () => void) => {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(ang);
        fn();
        ctx.restore();
      };
      const angOf = (u: { x: number; y: number }) => Math.atan2(u.x, -u.y);

      // 드론에서 가장 가까운 도로 지점
      let best = nearIdx;
      let bestD = Infinity;
      for (let i = 0; i < pts.length; i++) {
        const dd = meters(pos, pts[i]);
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
      nearIdx = best;
      const viewR = (D / 2) * mpp;
      const seg = segAtIdx(best);
      const laneM = 3.3;
      const carL = 4.6 * pxm * vis;
      const carW = 1.9 * pxm * vis;

      if (bestD < viewR + 50) {
        // 같은 방향(+1)·반대 방향(-1) 차로의 가상 차량 — 구간 속도만큼 흐르고, 방송 중이면 우측으로 비켜 정지
        const v = seg?.speedKmh ?? 30;
        const spacing = v < 20 ? 12 : v < 35 ? 19 : 32;
        const s0 = cum[best] - viewR;
        const s1 = cum[best] + viewR;
        for (const lane of [1, -1]) {
          const ms = lane > 0 ? (st.yielding ? 0 : v / 3.6) : 45 / 3.6;
          const off = (((st.simTime * ms * lane) % spacing) + spacing) % spacing;
          for (let s = Math.floor((s0 - off) / spacing) * spacing + off; s < s1; s += spacing) {
            if (s < 0 || s > total) continue;
            const slot = Math.round((s - off) / spacing);
            if (rand(slot * 7 + lane * 131) < 0.32) continue;
            const f = frameAt(s);
            const shift = lane > 0 && st.yielding ? 1.75 : 1;
            const x = f.a.x + f.n.x * lane * laneM * shift * pxm * 0.5 * vis;
            const y = f.a.y + f.n.y * lane * laneM * shift * pxm * 0.5 * vis;
            const color = CAR_COLORS[Math.floor(rand(slot * 3 + lane * 17) * CAR_COLORS.length)];
            drawAt(x, y, angOf(f.u) + (lane < 0 ? Math.PI : 0), () => drawCar(ctx, -carW / 2, -carL / 2, carW, carL, color));
          }
        }
      }

      // 사고 현장 (전방 차단)
      if (st.blockage && meters(pos, st.blockage) < viewR + 60) {
        const bp = project(st.blockage);
        let bi = 0;
        let bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const dd = meters(st.blockage, pts[i]);
          if (dd < bd) {
            bd = dd;
            bi = i;
          }
        }
        const f = frameAt(cum[bi]);
        const base = angOf(f.u);
        drawAt(bp.x - f.n.x * carW * 0.6, bp.y - f.n.y * carW * 0.6, base + 0.6, () => drawCar(ctx, -carW / 2, -carL / 2, carW, carL, "#e5e7eb"));
        drawAt(bp.x + f.n.x * carW * 0.7 + f.u.x * carL * 0.5, bp.y + f.n.y * carW * 0.7 + f.u.y * carL * 0.5, base - 0.9, () => drawCar(ctx, -carW / 2, -carL / 2, carW, carL, "#7f1d1d"));
        for (let k = -1; k <= 1; k++) {
          const cx = bp.x - f.u.x * carL * 1.6 + f.n.x * k * carW * 1.1;
          const cy = bp.y - f.u.y * carL * 1.6 + f.n.y * k * carW * 1.1;
          ctx.fillStyle = "#f97316";
          ctx.beginPath();
          ctx.moveTo(cx, cy - 6);
          ctx.lineTo(cx + 5, cy + 5);
          ctx.lineTo(cx - 5, cy + 5);
          ctx.closePath();
          ctx.fill();
        }
        const r = carL * 1.6;
        ctx.setLineDash([6, 4]);
        ctx.strokeStyle = "#ff3b3b";
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bp.x - r, bp.y - r, r * 2, r * 2);
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(127,29,29,0.92)";
        ctx.fillRect(bp.x - r, bp.y - r - 24, 150, 20);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 12px sans-serif";
        ctx.fillText("사고 차량 · 차로 차단", bp.x - r + 6, bp.y - r - 9);
      }

      // 진로방해(주정차) 차량 — 도로 우측 가장자리. 인식한 차량이 화면을 벗어나면 인식 결과만 왼쪽 위에 고정
      let lockDrawn = false;
      for (const pk of st.parked) {
        const pv = pk.sample.position;
        if (meters(pos, pv) > viewR + 30) continue;
        let bi = 0;
        let bd = Infinity;
        for (let i = 0; i < pts.length; i++) {
          const dd = meters(pv, pts[i]);
          if (dd < bd) {
            bd = dd;
            bi = i;
          }
        }
        const f = frameAt(cum[bi]);
        const p0 = project(pv);
        const x = p0.x + f.n.x * laneM * 1.9 * pxm * 0.5 * vis;
        const y = p0.y + f.n.y * laneM * 1.9 * pxm * 0.5 * vis;
        const color = pk.sample.vehicleType.includes("트럭") ? "#94a3b8" : pk.sample.vehicleType.includes("흰") ? "#f8fafc" : "#3f3f46";
        const len = pk.sample.vehicleType.includes("트럭") ? carL * 1.3 : carL;
        drawAt(x, y, angOf(f.u), () => drawCar(ctx, -carW / 2, -len / 2, carW, len, color));
        if (st.lockTarget?.id === pk.sample.id) {
          const half = len / 2 + 8;
          drawLock(x - half, y - half, half * 2, half * 2, pk.sample, pk.record, now);
          lockDrawn = true;
        }
      }
      if (st.lockTarget && !lockDrawn) drawLock(10, 40, 0, 0, st.lockTarget, st.lockTarget.record, now, false);

      // 소방차 (경광등 점멸)
      if (st.truckOn) {
        const tr = st.truck;
        const t = truckAt(tr, st.simTime);
        const k = t.segIndex;
        const t0 = tr.times[k];
        const t1 = tr.times[k + 1] ?? t0;
        const tf = t1 > t0 ? Math.max(0, Math.min(1, (st.simTime - t0) / (t1 - t0))) : 1;
        const fr = st.road.fr;
        const f = st.simTime >= tr.totalSec ? 1 : fr[k] + (fr[k + 1] - fr[k]) * tf;
        const tp = st.road.tools.at(f);
        const tl = { lat: tp[0], lng: tp[1] };
        if (meters(pos, tl) < viewR + 40) {
          const fa = frameAt(f * total);
          const x = fa.a.x + fa.n.x * laneM * 0.3 * pxm * vis;
          const y = fa.a.y + fa.n.y * laneM * 0.3 * pxm * vis;
          const L = 9 * pxm * vis;
          const Wd = 2.5 * pxm * vis;
          drawAt(x, y, angOf(fa.u), () => {
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(-Wd / 2 + 3, -L / 2 + 4, Wd, L);
            ctx.fillStyle = "#dc2626";
            ctx.fillRect(-Wd / 2, -L / 2, Wd, L);
            ctx.fillStyle = "#fff";
            ctx.fillRect(-Wd / 2, -L * 0.05, Wd, L * 0.06);
            const on = Math.floor(now / 250) % 2 === 0;
            ctx.fillStyle = on ? "#60a5fa" : "#ef4444";
            ctx.fillRect(-Wd / 2, -L / 2 + L * 0.12, Wd, L * 0.06);
          });
          ctx.fillStyle = "rgba(220,38,38,0.9)";
          ctx.font = "bold 11px sans-serif";
          ctx.fillText("소방차", x + 10, y - 8);
        }
      }
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = stateRef.current!;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const hovering = !!st.lockTarget;
      const v = st.phase === "transit" ? 260 : st.phase === "scan" ? (hovering ? 0 : 90) : st.phase === "prep" ? 0 : 0;
      scroll += v * dt;

      // 지도 영상 사용 여부 (비행 중 + 타일 수신 정상)
      const m = mapRef.current;
      const mapEl = mapElRef.current;
      let useMap = false;
      if (m && mapEl && (st.phase === "transit" || st.phase === "scan") && st.drone && !m.failed) {
        if (!m.activeSince) m.activeSince = now;
        if (m.loaded === 0 && now - m.activeSince > 6000) m.failed = true;
        else useMap = true;
      }
      if (mapEl) mapEl.style.visibility = useMap ? "visible" : "hidden";
      if (!useMap) headingInit = false;

      if (useMap && m && mapEl) {
        drawMapScene(m.map, mapEl, st, W, H, now);
      } else {
        // 합성 화면 (대기·오프라인): 건물 블록 + 직선 도로
        ctx.fillStyle = "#0c1118";
        ctx.fillRect(0, 0, W, H);
        const scale = st.phase === "transit" ? 0.55 : 1;
        const roadW = W * 0.42 * scale;
        const roadX = (W - roadW) / 2;
        const blockH = 120 * scale;
        for (let side = 0; side < 2; side++) {
          const x0 = side === 0 ? 0 : roadX + roadW + 14 * scale;
          const x1 = side === 0 ? roadX - 14 * scale : W;
          const off = scroll % blockH;
          for (let y = -blockH + off, i = Math.floor(-scroll / blockH); y < H + blockH; y += blockH, i++) {
            const r = rand(i * 3 + side);
            ctx.fillStyle = r > 0.7 ? "#1b2433" : r > 0.4 ? "#161e2b" : "#131a25";
            ctx.fillRect(x0 + 6, y + 6, x1 - x0 - 12, blockH - 14);
            ctx.fillStyle = "rgba(255,255,255,0.03)";
            ctx.fillRect(x0 + 14, y + 14, (x1 - x0) * 0.35, blockH * 0.3);
          }
        }
        ctx.fillStyle = "#222b38";
        ctx.fillRect(roadX - 14 * scale, 0, 14 * scale, H);
        ctx.fillRect(roadX + roadW, 0, 14 * scale, H);
        ctx.fillStyle = "#1a1f27";
        ctx.fillRect(roadX, 0, roadW, H);
        ctx.strokeStyle = "rgba(230,230,230,0.55)";
        ctx.lineWidth = 2 * scale;
        ctx.setLineDash([22 * scale, 18 * scale]);
        ctx.lineDashOffset = -scroll;
        ctx.beginPath();
        ctx.moveTo(W / 2, 0);
        ctx.lineTo(W / 2, H);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(250,204,21,0.5)";
        ctx.beginPath();
        ctx.moveTo(roadX + 3, 0);
        ctx.lineTo(roadX + 3, H);
        ctx.moveTo(roadX + roadW - 3, 0);
        ctx.lineTo(roadX + roadW - 3, H);
        ctx.stroke();

        const carW = roadW * 0.17;
        const carH = carW * 1.9;
        const lanes = [roadX + roadW * 0.12, roadX + roadW * 0.3, roadX + roadW * 0.56, roadX + roadW * 0.72];
        if (st.phase !== "standby") {
          const gap = st.phase === "scan" ? carH * 1.6 : carH * 3.2;
          lanes.forEach((lx, li) => {
            const off = (scroll * (li < 2 ? 1.05 : 0.95)) % gap;
            for (let y = -gap + off, i = 0; y < H + gap; y += gap, i++) {
              const k = Math.floor((scroll + y) / gap) + li * 31;
              if (rand(k) < 0.35) continue;
              const yieldShift = st.phase === "scan" && li === 1 ? roadW * 0.08 : 0;
              drawCar(ctx, lx + yieldShift, y, carW, carH, CAR_COLORS[Math.floor(rand(k + 7) * CAR_COLORS.length)]);
            }
          });
        }
        const targetX = roadX + roadW - carW - 6;
        const drawTarget = (sample: ViolationSample, y: number, locked: boolean, record?: ViolationRecord) => {
          drawCar(ctx, targetX, y, carW * 1.05, carH * 1.05, sample.vehicleType.includes("트럭") ? "#94a3b8" : sample.vehicleType.includes("흰") ? "#f1f5f9" : "#52525b");
          if (!locked) return;
          const pad = 8;
          drawLock(targetX - pad, y - pad, carW * 1.05 + pad * 2, carH * 1.05 + pad * 2, sample, record, now);
        };
        if (st.lockTarget) drawTarget(st.lockTarget, H * 0.42, true, st.lockTarget.record);
        else if (st.approach) drawTarget(st.approach.v, H * 0.42 - st.approach.ratio * H * 0.6, false);
      }

      // 카메라 질감: 비네트
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, useMap ? "rgba(0,0,0,0.45)" : "rgba(0,0,0,0.65)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // HUD
      ctx.strokeStyle = useMap ? "rgba(15,23,42,0.75)" : "rgba(255,255,255,0.55)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 14, H / 2);
      ctx.lineTo(W / 2 - 4, H / 2);
      ctx.moveTo(W / 2 + 4, H / 2);
      ctx.lineTo(W / 2 + 14, H / 2);
      ctx.moveTo(W / 2, H / 2 - 14);
      ctx.lineTo(W / 2, H / 2 - 4);
      ctx.moveTo(W / 2, H / 2 + 4);
      ctx.lineTo(W / 2, H / 2 + 14);
      ctx.stroke();

      ctx.font = "12px ui-monospace, Consolas, monospace";
      const spd = st.phase === "transit" ? 54 : st.phase === "scan" ? (hovering ? 0 : 28) : 0;
      const alt = st.phase === "transit" ? 120 : st.phase === "scan" ? 45 : 0;
      const hud = (text: string, x: number, y: number) => {
        if (useMap) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillRect(x - 4, y - 12, ctx.measureText(text).width + 8, 16);
        }
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.fillText(text, x, y);
      };
      hud(`ALT ${alt}m  SPD ${spd}km/h`, 10, H - 28);
      if (st.drone) hud(`GPS ${formatLatLng(droneAt(st.drone, st.simTime))}`, 10, H - 12);
      if (st.phase !== "standby" && st.phase !== "nodrone") {
        ctx.fillStyle = "#ef4444";
        ctx.beginPath();
        ctx.arc(W - 48, H - 16, 4, 0, Math.PI * 2);
        ctx.fill();
        hud("REC", W - 40, H - 12);
      }
      if (useMap) {
        ctx.font = "10px sans-serif";
        const att = "지도 © OpenStreetMap 기여자 · 지도 기반 가상 영상";
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(W - ctx.measureText(att).width - 14, H - 46, ctx.measureText(att).width + 8, 14);
        ctx.fillStyle = "rgba(255,255,255,0.9)";
        ctx.fillText(att, W - ctx.measureText(att).width - 10, H - 35);
      }

      // 대기/미투입 오버레이
      if (st.phase === "standby" || st.phase === "nodrone" || st.phase === "prep") {
        ctx.fillStyle = "rgba(17,20,26,0.82)";
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = "center";
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "bold 15px sans-serif";
        const msg =
          st.phase === "standby" ? "드론 대기 — 출동 지령 대기 중" : st.phase === "nodrone" ? "드론 미투입 — 투입 불필요 판정" : "원격 조종자 이륙 준비 중";
        ctx.fillText(msg, W / 2, H / 2 - 4);
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#9ca3af";
        const sub =
          st.phase === "standby"
            ? "혼잡 경로일 때만 1~2대 투입"
            : st.phase === "nodrone"
              ? "소방차 단독 출동 · 거점 드론 대기 유지"
              : `권장 이륙 시각 T+${formatClock((st.drone?.launchSec ?? 0) + 30)}`;
        ctx.fillText(sub, W / 2, H / 2 + 16);
        ctx.textAlign = "left";
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const broadcasting = phase === "scan" && !!drone && simTime >= drone.broadcastSec;
  // 선행 정찰 드론: 정찰 구간을 지나 소방차 경로를 따라 전방 확인 → 차단 발견 → 우회로 확인
  const blk = plan.blockage && drone && drone.assignment.droneId === plan.blockage.droneId ? plan.blockage : null;
  const ahead = phase === "scan" && !!drone?.aheadSec && simTime >= drone.aheadSec;
  const scoutBanner = !blk || !ahead
    ? null
    : simTime < blk.atSec
      ? { text: "소방차 경로를 따라 전방 선행 정찰 중", cls: "bg-black/60 text-white" }
      : sim.routeChoice === "detour"
        ? { text: `우회로 선행 확인 중 — ${blk.summary}`, cls: "bg-emerald-700 text-white" }
        : sim.routeChoice === "stay"
          ? { text: `전방 차단 구간 길터주기 방송 중 — ${blk.label}`, cls: "bg-fire text-white" }
          : { text: `전방 차단 확인 — ${blk.label} · 상황실 우회로 판단 중`, cls: "bg-fire text-white" };
  const banner = scoutBanner
    ? scoutBanner
    : broadcasting
      ? { text: "길터주기 LED·음성 방송 중 — \"긴급차량 접근 중, 우측으로 양보 바랍니다\"", cls: "bg-fire text-white" }
      : phase === "scan"
        ? { text: "정찰·탐지 중 (방송은 소방차 도착 3분 전부터)", cls: "bg-black/60 text-white" }
        : phase === "transit"
          ? { text: "원격 조종자가 권장 경로로 소방차 경로 합류 중", cls: "bg-black/60 text-white" }
          : phase === "prep"
            ? { text: "원격 조종자 이륙 준비", cls: "bg-black/60 text-white" }
            : null;
  const pilotNo = drone ? plan.drones.indexOf(drone) + 1 : 0;
  const t = big ? "text-[16px]" : "text-[12px]";

  return (
    <section className="box flex h-full min-h-[260px] flex-col overflow-hidden">
      <div className="box-head">
        <Video size={15} className="text-navy" />
        <span className={big ? "text-[18px]" : ""}>드론 실시간 영상{big ? " (상황실 공유)" : ""}</span>
        {drone && launch && (
          <span className="tag text-drone">
            {drone.assignment.droneId} · {drone.assignment.role === "guide+detect" ? "유도+탐지" : "유도"}
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {plan.drones.length > 1 &&
            launch &&
            plan.drones.map((d) => (
              <button
                key={d.assignment.droneId}
                onClick={() => sim.setFocusDrone(d.assignment.droneId)}
                className={`border px-2 py-0.5 font-mono text-[11px] ${
                  drone?.assignment.droneId === d.assignment.droneId ? "border-navy bg-navy text-white" : "border-line bg-white text-muted hover:bg-subtle"
                }`}
              >
                {d.assignment.droneId}
              </button>
            ))}
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1 overflow-hidden bg-black">
        {/* 하향 영상 바탕 지도 (회전) — 조작 불가 */}
        <div
          ref={mapElRef}
          aria-hidden
          className="pointer-events-none absolute"
          style={{ visibility: "hidden", transformOrigin: "50% 50%", filter: "saturate(0.6) brightness(0.88) contrast(1.08)", background: "#d8d4cc" }}
        />
        <canvas ref={canvasRef} className="absolute inset-0" aria-label="드론 영상 시뮬레이션 화면" />
        {banner && <div className={`absolute left-0 right-0 top-0 px-3 py-1.5 font-semibold ${t} ${banner.cls}`}>{banner.text}</div>}
        {drone && launch && phase === "scan" && (
          <div className={`absolute bottom-[64px] right-2 bg-black/60 px-1.5 py-0.5 text-white/85 ${big ? "text-[13px]" : "text-[10.5px]"}`}>
            촬영 고지 중 · 얼굴 자동 블러 · 번호판 인식 결과 최소 보관
          </div>
        )}
      </div>
      {drone && launch && (
        <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 ${t}`}>
          <span>
            <span className="text-muted">담당 구간 </span>
            <b>{drone.assignment.cluster.hotspots[0]?.name ?? drone.assignment.cluster.label}</b>
          </span>
          <span>
            <span className="text-muted">소방차보다 </span>
            <b className="font-mono text-ok">{formatClock(drone.leadSec)}</b>
            <span className="text-muted"> 먼저</span>
          </span>
          <span className="ml-auto flex items-center gap-1">
            <UserRound size={big ? 16 : 13} className="text-navy" />
            <b className="text-navy">원격 조종자 {pilotNo} 조종 중</b>
            <span className="text-muted">· 권장 경로 안내</span>
          </span>
        </div>
      )}
    </section>
  );
}
