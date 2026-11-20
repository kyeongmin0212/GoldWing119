"use client";

// 선행 드론 실시간 영상(앞으로 기울인 카메라, 정찰 고도 약 18m) 시뮬레이터 — 바운딩 박스, 번호판 OCR
// 바탕은 코드로 그린 가상 동네 장면(굽은 길·골목·상가·주택, src/lib/aerialScene.ts) — 실제 영상·지도 아님, 인터넷 불필요.
// 그 위에 시뮬레이션 위치에 맞춰 진로방해 차량·막힌 지점(사고/불법주차)·소방차를 그린다.
// 위치는 "소방차 경로를 따라 드론에서 몇 m 앞/뒤인가"로 가상 장면에 옮긴다.
// 상황실 콘솔과 소방차 태블릿(보기 전용, 큰 글씨)이 같이 쓴다. 드론은 상황실 원격 조종자(사람)가 조종한다.

import { useEffect, useMemo, useRef } from "react";
import { UserRound, Video } from "lucide-react";
import { LANE, ROAD_HALF, createAerialScene } from "@/lib/aerialScene";
import { formatClock, formatLatLng, truckAt, type TruckTimeline } from "@/lib/geo";
import type { ScenarioRoad } from "@/lib/road";
import { droneAt, type DroneSim } from "@/lib/simulation";
import type { SimView } from "@/lib/simView";
import type { LatLng, ViolationRecord, ViolationSample } from "@/types/drone";

type Phase = "standby" | "nodrone" | "prep" | "transit" | "scan";

interface FrameState {
  phase: Phase;
  drone: DroneSim | null;
  simTime: number;
  lockTarget: (ViolationSample & { record?: ViolationRecord }) | null;
  road: ScenarioRoad;
  roadPts: LatLng[];
  /** 도로 선 누적 거리(m) */
  cum: number[];
  truck: TruckTimeline;
  truckOn: boolean;
  parked: { sample: ViolationSample; record?: ViolationRecord }[];
  blockage: { pos: LatLng; kind: "accident" | "parking"; short: string } | null;
  /** 길터주기 방송 중 — 같은 방향 차량이 가장자리로 비켜섬 */
  yielding: boolean;
  seed: number;
}

const R_EARTH = 6371000;
/** 두 점 사이 거리(m) — 짧은 거리용 근사 */
function meters(a: LatLng, b: LatLng): number {
  const x = ((b.lng - a.lng) * Math.PI * R_EARTH * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180))) / 180;
  const y = ((b.lat - a.lat) * Math.PI * R_EARTH) / 180;
  return Math.hypot(x, y);
}

/** 1m = 가상 장면 몇 단위 (차로 폭 15단위 ≈ 3.5m) */
const UPM = LANE / 3.5;

/** 점 p 가 도로 선을 따라 몇 m 지점인지 (가장 가까운 선분에 투영) */
function alongRoad(p: LatLng, pts: LatLng[], cum: number[]): { along: number; dist: number } {
  let best = { along: 0, dist: Infinity };
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const seg = cum[i + 1] - cum[i];
    if (seg <= 0) continue;
    const ax = 0;
    const bx = meters(a, { lat: a.lat, lng: b.lng }) * Math.sign(b.lng - a.lng);
    const by = meters(a, { lat: b.lat, lng: a.lng }) * Math.sign(b.lat - a.lat);
    const px = meters(a, { lat: a.lat, lng: p.lng }) * Math.sign(p.lng - a.lng);
    const py = meters(a, { lat: p.lat, lng: a.lng }) * Math.sign(p.lat - a.lat);
    const len2 = bx * bx + by * by || 1;
    const t = Math.max(0, Math.min(1, ((px - ax) * bx + py * by) / len2));
    const d = Math.hypot(px - bx * t, py - by * t);
    if (d < best.dist) best = { along: cum[i] + seg * t, dist: d };
  }
  return best;
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
  const stateRef = useRef<FrameState | null>(null);
  const lockStartRef = useRef<{ id: string; at: number } | null>(null);

  const { plan, simTime, status, launch, violations } = sim;
  const drone = plan.drones.find((d) => d.assignment.droneId === sim.focusDrone) ?? plan.drones[plan.drones.length - 1] ?? null;

  let phase: Phase = "standby";
  if (status === "idle" || status === "awaiting") phase = "standby";
  else if (!launch || !drone) phase = "nodrone";
  else if (simTime < drone.takeoffSec) phase = "prep";
  else if (simTime < drone.scanStartSec) phase = "transit";
  else phase = "scan";

  // 이 드론의 탐지 일정
  const myDet = drone ? plan.detections.filter((d) => d.droneId === drone.assignment.droneId) : [];
  let lockTarget: FrameState["lockTarget"] = null;
  if (phase === "scan") {
    for (let i = 0; i < myDet.length; i++) {
      const d = myDet[i];
      const next = myDet[i + 1];
      const v = sim.scenario.violations.find((x) => x.id === d.violationId)!;
      if (simTime >= d.atSec && (!next || simTime < next.atSec - 25)) lockTarget = { ...v, record: violations.find((r) => r.id === v.id) };
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
    lockTarget,
    road,
    roadPts: roadData.pts,
    cum: roadData.cum,
    truck: plan.truck,
    truckOn: status !== "idle" && status !== "awaiting",
    parked: sim.scenario.violations.filter((v) => myIds.has(v.id)).map((v) => ({ sample: v, record: violations.find((r) => r.id === v.id) })),
    blockage: plan.blockage ? { pos: plan.blockage.position, kind: plan.blockage.kind, short: plan.blockage.short } : null,
    yielding: phase === "scan" && !!drone && simTime >= drone.broadcastSec,
    seed: sim.mode === "urban" ? 7 : 3,
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let last = performance.now();
    let transitS = 0;
    let yieldAmt = 0;
    let zoom = 1;
    let scene = createAerialScene(3);
    let sceneSeed = 3;
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      canvas.width = Math.max(1, r.width * dpr);
      canvas.height = Math.max(1, r.height * dpr);
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
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
        [
          [bx, by, 1, 1],
          [bx + bw, by, -1, 1],
          [bx, by + bh, 1, -1],
          [bx + bw, by + bh, -1, -1],
        ].forEach(([x, yy, sx, sy]) => {
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

    const label = (text: string, x: number, y: number, bg: string) => {
      ctx.font = "bold 12px sans-serif";
      const w = ctx.measureText(text).width + 12;
      ctx.fillStyle = bg;
      ctx.fillRect(x, y, w, 20);
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x + 6, y + 14);
    };

    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const st = stateRef.current!;
      const W = canvas.width / dpr;
      const H = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (st.seed !== sceneSeed) {
        sceneSeed = st.seed;
        scene = createAerialScene(sceneSeed);
      }

      // 드론 위치 → 가상 장면 위치 (정찰 중엔 경로를 따라 간 거리, 순항 중엔 빠르게 흘러감)
      const flying = st.phase === "transit" || st.phase === "scan";
      const droneAlong = st.phase === "scan" && st.drone ? alongRoad(droneAt(st.drone, st.simTime), st.roadPts, st.cum).along : 0;
      if (st.phase === "transit") transitS += 260 * dt;
      const s = st.phase === "scan" ? 2000 + droneAlong * UPM : transitS;
      zoom += ((st.phase === "transit" ? 0.55 : 1) - zoom) * Math.min(1, dt * 3);
      yieldAmt += ((st.yielding ? 1 : 0) - yieldAmt) * Math.min(1, dt * 1.5);
      const toWy = (alongM: number) => s + (alongM - droneAlong) * UPM;
      const scanning = st.phase === "scan";
      const blockWy = scanning && st.blockage?.kind === "accident" ? toWy(alongRoad(st.blockage.pos, st.roadPts, st.cum).along) : undefined;
      const keepClearWy = scanning
        ? [...st.parked.map((pk) => toWy(alongRoad(pk.sample.position, st.roadPts, st.cum).along)), ...(st.blockage?.kind === "parking" ? [toWy(alongRoad(st.blockage.pos, st.roadPts, st.cum).along)] : [])]
        : [];
      const v = scene.draw(ctx, W, H, { s, zoom, t: flying ? now / 1000 : 0, yieldAmt, blockWy, keepClearWy });
      // 먼 곳은 옅은 안개 (기울인 카메라의 원근감)
      const haze = ctx.createLinearGradient(0, 0, 0, H * 0.32);
      haze.addColorStop(0, "rgba(214,219,226,0.62)");
      haze.addColorStop(1, "rgba(214,219,226,0)");
      ctx.fillStyle = haze;
      ctx.fillRect(0, 0, W, H * 0.32);
      /** 경로 위 지점(m) → 장면 wy. 드론 기준 앞/뒤 거리로 옮긴다 */
      const wyOf = toWy;
      // 화면 안(아래 끝 여유 제외)에 들어오는 지점만 — 이미 지나친 곳은 그리지 않는다
      const visible = (wy: number) => wy > v.wyMin + 60 && wy < v.wyMax - 20;
      const boxR = (r: number) => Math.min(r, Math.min(W, H) * 0.32);

      if (st.phase === "scan") {
        const pts = st.roadPts;
        const cum = st.cum;
        const total = cum[cum.length - 1] || 1;

        // 막힌 지점
        if (st.blockage) {
          const wy = wyOf(alongRoad(st.blockage.pos, pts, cum).along);
          if (visible(wy)) {
            if (st.blockage.kind === "accident") {
              v.car(ctx, LANE * 0.85, wy - 14, -0.9, "#7f1d1d", 0, { plate: "34마 8120" });
              v.car(ctx, LANE * 0.45 - 3, wy, 0.6, "#e5e7eb", 0, { plate: "61라 2207" });
              for (let k = 0; k < 3; k++) {
                const [cx, cy] = v.M(LANE * (0.2 + k * 0.4), wy - 32);
                const kk = v.kAt(LANE * (0.2 + k * 0.4), wy - 32);
                ctx.fillStyle = "#f97316";
                ctx.beginPath();
                ctx.moveTo(cx, cy - 2.6 * kk);
                ctx.lineTo(cx + 2.2 * kk, cy + 2.2 * kk);
                ctx.lineTo(cx - 2.2 * kk, cy + 2.2 * kk);
                ctx.closePath();
                ctx.fill();
              }
              const [px, py] = v.screen(LANE * 0.6, wy - 6);
              const r = boxR(26 * v.kAt(LANE * 0.6, wy - 6));
              ctx.setLineDash([6, 4]);
              ctx.strokeStyle = "#ff3b3b";
              ctx.lineWidth = 2.5;
              ctx.strokeRect(px - r, py - r, r * 2, r * 2);
              ctx.setLineDash([]);
              label("사고 차량 · 차로 차단", px - r, py - r - 24, "rgba(127,29,29,0.92)");
            } else {
              const [px, py] = v.screen(ROAD_HALF - 6, wy);
              const r = boxR(30 * v.kAt(ROAD_HALF - 6, wy));
              ctx.setLineDash([6, 4]);
              ctx.strokeStyle = "#f59e0b";
              ctx.lineWidth = 2.5;
              ctx.strokeRect(px - r, py - r, r * 2, r * 2);
              ctx.setLineDash([]);
              label(st.blockage.short, px - r, py + r + 4, "rgba(120,53,15,0.92)");
            }
          }
        }

        // 진로방해(주정차) 차량 — 도로 오른쪽 가장자리. 인식한 차량이 화면을 벗어나면 인식 결과만 왼쪽 위에 고정
        let lockDrawn = false;
        for (const pk of st.parked) {
          const wy = wyOf(alongRoad(pk.sample.position, pts, cum).along);
          if (!visible(wy)) continue;
          const truckLike = pk.sample.vehicleType.includes("트럭") || pk.sample.vehicleType.includes("화물");
          const color = truckLike ? "#94a3b8" : pk.sample.vehicleType.includes("흰") ? "#f8fafc" : pk.sample.vehicleType.includes("회색") ? "#8b9097" : "#2b2d31";
          v.car(ctx, ROAD_HALF - 5, wy, 0, color, 0, truckLike ? { len: 24, wid: 10, plate: pk.sample.plate } : { plate: pk.sample.plate });
          if (st.lockTarget?.id === pk.sample.id) {
            const [sx, sy] = v.screen(ROAD_HALF - 5, wy);
            const half = (truckLike ? 15 : 13) * v.kAt(ROAD_HALF - 5, wy);
            drawLock(sx - half, sy - half, half * 2, half * 2, pk.sample, pk.record, now);
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
          const wy = wyOf(f * total);
          if (visible(wy)) {
            v.car(ctx, LANE * 0.5 + yieldAmt * -3, wy, 0, "#c8102e", 0, { len: 30, wid: 11, truck: true, blink: Math.floor(now / 250) % 2 === 0 });
            const [sx, sy] = v.screen(LANE * 0.5, wy);
            label("소방차", sx + 12 * v.kAt(LANE * 0.5, wy), sy - 8, "rgba(200,16,46,0.9)");
          }
        }
      }

      // 카메라 질감: 약한 비네트
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.8);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.38)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);

      // HUD 조준선 (화면 가운데 = 드론이 내려다보는 지점)
      const cy = v.cy;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(W / 2 - 14, cy);
      ctx.lineTo(W / 2 - 4, cy);
      ctx.moveTo(W / 2 + 4, cy);
      ctx.lineTo(W / 2 + 14, cy);
      ctx.moveTo(W / 2, cy - 14);
      ctx.lineTo(W / 2, cy - 4);
      ctx.moveTo(W / 2, cy + 4);
      ctx.lineTo(W / 2, cy + 14);
      ctx.stroke();

      ctx.font = "12px ui-monospace, Consolas, monospace";
      // 속도는 시뮬레이션 드론의 실제 이동(2초)으로, 고도는 카메라 높이로
      const spd = st.drone && flying ? Math.round((meters(droneAt(st.drone, st.simTime), droneAt(st.drone, st.simTime + 2)) / 2) * 3.6) : 0;
      const alt = flying ? Math.round(v.altM) : 0;
      const hud = (text: string, x: number, y: number) => {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.fillRect(x - 4, y - 12, ctx.measureText(text).width + 8, 16);
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
      ctx.font = "10px sans-serif";
      const note = "가상 장면 (시뮬레이션)";
      const nw = ctx.measureText(note).width;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(W - nw - 14, H - 46, nw + 8, 14);
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      ctx.fillText(note, W - nw - 10, H - 35);

      // 대기/미투입 오버레이
      if (st.phase === "standby" || st.phase === "nodrone" || st.phase === "prep") {
        ctx.fillStyle = "rgba(17,20,26,0.82)";
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = "center";
        ctx.fillStyle = "#e5e7eb";
        ctx.font = "bold 15px sans-serif";
        const msg = st.phase === "standby" ? "드론 대기 — 출동 지령 대기 중" : st.phase === "nodrone" ? "드론 미투입 — 투입 불필요 판정" : "원격 조종자 이륙 준비 중";
        ctx.fillText(msg, W / 2, H / 2 - 4);
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#9ca3af";
        const sub =
          st.phase === "standby"
            ? "혼잡 경로일 때만 1~2대 투입"
            : st.phase === "nodrone"
              ? "소방차 단독 출동 · 거점 드론 대기 유지"
              : `권장 이륙 시각 T+${formatClock(st.drone?.takeoffSec ?? 0)}`;
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

  // 선행 정찰 드론: 정찰 구간을 지나 소방차 경로를 따라 전방 확인 → 차단 발견 → 우회로 확인
  const blk = plan.blockage && drone && drone.assignment.droneId === plan.blockage.droneId ? plan.blockage : null;
  const ahead = phase === "scan" && !!drone?.aheadSec && simTime >= drone.aheadSec;
  const parkingSeen = !!blk && blk.kind === "parking" && phase === "scan" && simTime >= blk.atSec;
  const scoutBanner = parkingSeen && blk
    ? sim.routeChoice === "detour"
      ? { text: `다른 진입 경로 안내함 — ${blk.summary} · 주차 차량 증거 촬영 중`, cls: "bg-emerald-700 text-white" }
      : sim.routeChoice === "stay"
        ? { text: `기존 경로 유지 — ${blk.label} · 주차 차량 증거 촬영 중`, cls: "bg-fire text-white" }
        : { text: `진입로 불법주차 확인 — ${blk.label} · 상황실 경로 판단 중`, cls: "bg-fire text-white" }
    : !blk || !ahead
    ? null
    : simTime < blk.atSec
      ? { text: "소방차 경로를 따라 전방 선행 정찰 중", cls: "bg-black/60 text-white" }
      : sim.routeChoice === "detour"
        ? { text: `우회로 선행 확인 중 — ${blk.summary}`, cls: "bg-emerald-700 text-white" }
        : sim.routeChoice === "stay"
          ? { text: `기존 경로 유지 — ${blk.label}`, cls: "bg-fire text-white" }
          : { text: `전방 도로 막힘 확인 — ${blk.label} · 상황실 경로 판단 중`, cls: "bg-fire text-white" };
  const banner = scoutBanner
    ? scoutBanner
    : phase === "scan"
      ? { text: "소방차 경로 정찰·탐지 중", cls: "bg-black/60 text-white" }
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
