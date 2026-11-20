"use client";

// 선행 드론 실시간 영상(앞으로 기울인 카메라, 정찰 고도 약 18m) 시뮬레이터 — 바운딩 박스, 번호판 OCR
// 바탕은 코드로 그린 가상 동네 장면(굽은 길·골목·상가·주택, src/lib/aerialScene.ts) — 실제 영상·지도 아님, 인터넷 불필요.
// 그 위에 시뮬레이션 위치에 맞춰 진로방해 차량·막힌 지점(도로 공사/불법주차)·소방차를 그린다.
// 위치는 "소방차 경로를 따라 드론에서 몇 m 앞/뒤인가"로 가상 장면에 옮긴다.
// 상황실 콘솔과 소방차 태블릿(보기 전용, 큰 글씨)이 같이 쓴다. 드론은 상황실 원격 조종자(사람)가 조종한다.

import { useEffect, useMemo, useRef } from "react";
import { UserRound, Video } from "lucide-react";
import { LANE, ROAD_HALF, createAerialScene, type AerialSolid, type AerialView } from "@/lib/aerialScene";
import { formatClock, formatLatLng, truckAt, type TruckTimeline } from "@/lib/geo";
import { scenarioRoute, type ScenarioRoad } from "@/lib/road";
import { droneAt, type DroneSim } from "@/lib/simulation";
import { maskPlate } from "@/lib/plate";
import type { SimView } from "@/lib/simView";
import type { LatLng, ViolationRecord, ViolationSample } from "@/types/drone";

type Phase = "standby" | "nodrone" | "prep" | "transit" | "scan";
/**
 * 갈림길 정보: 그 경로 선에서 갈림길까지 거리(m), 갈림길 조금 앞(at, m)부터 갈림길 뒤 FORK_LEN_M 까지의 진행 방향 표.
 * 진행 방향 표는 선 전체로 계산한 표(headingTable)를 잘라 쓴다 — 갈림길 앞뒤로 부드럽게 꺾이는 부분까지
 * 큰길을 이 선으로 바꿨을 때와 똑같이 그려져, 미리 그린 길과 전환 뒤 길이 정확히 겹친다.
 */
type ForkLine = { junction: number; at: number; branch: number[]; th: number[] };
/** 갈림길 정보 표에서 경로 선 위 m 지점의 진행 방향 */
const forkDir = (f: ForkLine, m: number) => f.branch[Math.max(0, Math.min(f.branch.length - 1, Math.round((m - f.at) / PATH_STEP_M)))];
/** 갈림길 도로를 미리 그려 둘 길이(m) */
const FORK_LEN_M = 300;

interface FrameState {
  phase: Phase;
  drone: DroneSim | null;
  simTime: number;
  lockTarget: (ViolationSample & { record?: ViolationRecord }) | null;
  road: ScenarioRoad;
  roadPts: LatLng[];
  /** 우회 승인 뒤: 기존 경로 선(되돌아가는 구간을 그리기 위해)과 갈림길까지 거리(m) */
  basePts: LatLng[] | null;
  baseCum: number[] | null;
  junctionAlong: number | null;
  /** 지금 경로 선(roadPts)이 기존 경로인가 (우회 승인 전) */
  onBaseLine: boolean;
  /** 우회로가 있는 시나리오: 기존·우회 경로 각각의 갈림길 위치(m)와 갈림길부터의 진행 방향 표 — 서로의 갈림길 도로로 미리 그린다 */
  fork: { base: ForkLine; det: ForkLine } | null;
  /** 도로 선 누적 거리(m) */
  cum: number[];
  truck: TruckTimeline;
  truckOn: boolean;
  parked: { sample: ViolationSample; record?: ViolationRecord }[];
  blockage: { pos: LatLng; kind: "roadwork" | "parking"; short: string } | null;
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

/** 영상 속 길 방향 표: 도로 선을 따라 2m 마다 진행 방향(위쪽 0, 오른쪽 +).
 *  앞뒤 12m 만 평균 — 길은 곧게 가다가 교차로에서만 짧게 돈다 (넓게 펴면 화면 전체 길이 바나나처럼 휘어 보임). */
const PATH_STEP_M = 2;
const PATH_SMOOTH_M = 12;
function headingTable(pts: LatLng[], cum: number[]): number[] {
  const total = cum[cum.length - 1] || 0;
  if (pts.length < 2 || total <= 0) return [];
  const lat0 = pts[0].lat;
  const kx = (Math.PI * R_EARTH * Math.cos((lat0 * Math.PI) / 180)) / 180;
  const ky = (Math.PI * R_EARTH) / 180;
  const xy = pts.map((p) => [(p.lng - pts[0].lng) * kx, (p.lat - lat0) * ky]);
  let seg = 1;
  const pos = (a: number): number[] => {
    const d = Math.max(0, Math.min(total, a));
    seg = Math.max(1, Math.min(seg, cum.length - 1));
    while (seg > 1 && cum[seg - 1] > d) seg--;
    while (seg < cum.length - 1 && cum[seg] < d) seg++;
    const len = cum[seg] - cum[seg - 1] || 1;
    const t = (d - cum[seg - 1]) / len;
    return [xy[seg - 1][0] + (xy[seg][0] - xy[seg - 1][0]) * t, xy[seg - 1][1] + (xy[seg][1] - xy[seg - 1][1]) * t];
  };
  const n = Math.ceil(total / PATH_STEP_M) + 1;
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = i * PATH_STEP_M;
    const p0 = pos(a - 6);
    const p1 = pos(a + 6);
    let th = Math.atan2(p1[0] - p0[0], p1[1] - p0[1]);
    if (i > 0) {
      // 이어지게 펼치기 (359° → 1° 를 +2° 로)
      const prev = raw[i - 1];
      while (th - prev > Math.PI) th -= 2 * Math.PI;
      while (th - prev < -Math.PI) th += 2 * Math.PI;
    }
    raw.push(th);
  }
  const w = Math.round(PATH_SMOOTH_M / PATH_STEP_M);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i - w; j <= i + w; j++) sum += raw[Math.max(0, Math.min(n - 1, j))];
    out.push(sum / (2 * w + 1));
  }
  return out;
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
  const baseData = useMemo(() => {
    const det = sim.scenario.blockage?.detour;
    if (plan.route.variant !== "detour" || !det) return null;
    const b = scenarioRoute(sim.scenario, "base").road;
    const pts = b.line.map(([lat, lng]) => ({ lat, lng }));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + meters(pts[i - 1], pts[i]));
    return { pts, cum, junction: cum[b.idx[det.fromSeg]] };
  }, [plan.route.variant, sim.scenario]);
  // 우회로 갈림길: 기존 경로를 갈 때는 우회로가, 우회로를 갈 때는 막힌 기존 길이 옆으로 갈라지는 도로로 보이게
  const forkData = useMemo(() => {
    const det = sim.scenario.blockage?.detour;
    if (!det) return null;
    const dr = scenarioRoute(sim.scenario, "detour");
    if (dr.variant !== "detour") return null;
    const mk = (r: ScenarioRoad): ForkLine => {
      const pts = r.line.map(([lat, lng]) => ({ lat, lng }));
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + meters(pts[i - 1], pts[i]));
      const junction = cum[r.idx[det.fromSeg]];
      // 갈림길 앞 (부드럽게 펴는 폭 + 방향 재는 폭) 지점부터 — 거기까지는 두 선이 같아 큰길과 겹친다
      const th = headingTable(pts, cum);
      const k0 = Math.max(0, Math.floor((junction - PATH_SMOOTH_M - 6) / PATH_STEP_M) - 1);
      const k1 = Math.min(th.length, Math.ceil((junction + FORK_LEN_M) / PATH_STEP_M) + 1);
      return { junction, at: k0 * PATH_STEP_M, branch: th.slice(k0, k1), th };
    };
    return { base: mk(scenarioRoute(sim.scenario, "base").road), det: mk(dr.road) };
  }, [sim.scenario]);
  const myIds = new Set(myDet.map((d) => d.violationId));

  stateRef.current = {
    phase,
    drone,
    simTime,
    lockTarget,
    road,
    roadPts: roadData.pts,
    basePts: baseData?.pts ?? null,
    baseCum: baseData?.cum ?? null,
    junctionAlong: baseData?.junction ?? null,
    onBaseLine: plan.route.variant !== "detour",
    fork: forkData,
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
    let alongDisp = 0;
    /** 시뮬레이션 배속 추정(시뮬 초 / 실제 초) */
    let simRate = 5;
    let lastSim: number | null = null;
    let turnTarget = 0;
    /** 화면에 보이는 카메라 방향(세계 기준) — 뒤돌기·갈림길에서 끊기지 않고 이어서 돈다 */
    let camDisp: number | null = null;
    let yieldAmt = 0;
    let zoom = 1;
    let scene = createAerialScene(3);
    /** 갈림길 저쪽 경로를 큰길로 둔 장면 — 갈림길 근처에서 저쪽 길 방향 화면을 이 장면으로 그린다 */
    let sceneO = createAerialScene(3);
    let sceneSeed = 3;
    let pathOf: number[] | null = null;
    /** 우회 승인 뒤 갈림길에서 우회선으로 바꿨는가 (어느 계획의 것인지 detourKey 로 구분) */
    let onDetour = false;
    let reachedJ = false;
    let detourKey: number[] | null = null;
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
      const plate = maskPlate(sample.plate);
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
        sceneO = createAerialScene(sceneSeed);
        pathOf = null;
      }
      // 우회 승인 뒤 드론이 갈림길까지 왔던 길로 되돌아가는 동안은 기존 경로 선을 쓰고(뒤돌아 비행), 갈림길에 닿으면 우회로 선으로.
      // 바꾸는 때는 실제 드론 위치가 아니라 화면 위치(alongDisp)로 정한다 — 화면 위치는 조금 늦게 따라오므로,
      // 실제 위치로 바꾸면 그 순간 화면 위치가 우회로 안쪽으로 순간이동했다가 미끄러지고 카메라가 한 번에 돌았다.
      // 한 번 바꾸면 그대로 둔다(갈림길까지 두 선의 앞부분이 같아 위치가 이어진다).
      let R = { pts: st.roadPts, cum: st.cum };
      let onBase = st.onBaseLine;
      let holdBase = false;
      if (st.baseCum !== detourKey) {
        detourKey = st.baseCum;
        onDetour = false;
        reachedJ = false;
      }
      if (st.basePts && st.baseCum && st.junctionAlong !== null && st.drone && (st.phase === "scan" || st.phase === "transit") && !onDetour) {
        const b = alongRoad(droneAt(st.drone, st.simTime), st.basePts, st.baseCum);
        // 실제 드론이 갈림길에 닿았으면 그 뒤로는 화면 위치를 갈림길로 끌어온다
        // (우회로에 들어간 실제 위치를 기존 선에 비추면 갈림길 조금 뒤로 나와, 화면 위치가 갈림길에 못 닿고 멈춰 있었다)
        // (빠른 배속에서는 장면 사이에 갈림길을 건너뛸 수 있으므로, 기존 선을 벗어났으면 이미 갈림길을 지난 것으로 본다)
        if (b.along <= st.junctionAlong + 3 || b.dist > 25) reachedJ = true;
        // 화면 위치가 갈림길에서 멀리 떨어진 채 기존 선을 벗어났으면(드론을 바꿔 보거나 시간을 건너뛴 경우) 바로 우회선으로
        if ((b.dist > 60 && Math.abs(alongDisp - st.junctionAlong) > 300) || alongDisp <= st.junctionAlong + 1) onDetour = true;
        else {
          R = { pts: st.basePts, cum: st.baseCum };
          onBase = true;
          holdBase = true;
        }
      }
      // 영상 속 길을 지금 쓰는 경로 선 방향대로 — 선이 바뀔 때만 다시 계산
      if (pathOf !== R.cum) {
        pathOf = R.cum;
        scene.setPath({ wy0: 2000, step: PATH_STEP_M * UPM, theta: headingTable(R.pts, R.cum) });
        // 갈림길 도로: 지금 길의 갈림길 지점에서 다른 쪽 경로(우회로 또는 막힌 기존 길)를 미리 그려 둔다
        const fk = st.fork;
        if (fk) {
          const main = onBase ? fk.base : fk.det;
          const other = onBase ? fk.det : fk.base;
          scene.setBranches([{ atWy: 2000 + other.at * UPM, step: PATH_STEP_M * UPM, theta: other.branch }]);
          // 저쪽 경로 장면: 저쪽 길이 큰길(길가 건물·보도·차까지), 지금 길이 갈림길 — 갈림길을 지난 뒤 보일 모습 그대로
          sceneO.setPath({ wy0: 2000, step: PATH_STEP_M * UPM, theta: other.th });
          sceneO.setBranches([{ atWy: 2000 + main.at * UPM, step: PATH_STEP_M * UPM, theta: main.branch }]);
        }
      }

      // 드론 위치 → 가상 장면 위치: 순항·정찰 모두 소방차 경로를 따라 실제로 간 거리로 (속도가 갑자기 바뀌지 않게)
      // 경로가 바뀌는 순간(우회 승인) 생기는 작은 차이는 부드럽게 따라간다
      const flying = st.phase === "transit" || st.phase === "scan";
      // 기존 선을 붙잡고 있는 동안은 갈림길보다 앞으로(이미 우회로에 들어간 실제 위치가 기존 선에 비쳐) 가지 않게
      const jMin = holdBase && st.junctionAlong !== null ? st.junctionAlong : -Infinity;
      // 갈림길보다 3m 앞을 목표로 — 화면 위치가 갈림길(+1m)을 금방 넘어 우회선으로 바뀐다(모퉁이에서 오래 멈칫하지 않게)
      const jHold = holdBase && reachedJ ? jMin - 3 : null;
      const target = flying && st.drone ? jHold ?? Math.max(jMin, alongRoad(droneAt(st.drone, st.simTime), R.pts, R.cum).along) : 0;
      // 진행 방향: 2초 뒤(시뮬레이션) 경로상 위치가 줄면 되돌아가는 중 → 카메라를 뒤로 돌린다
      if (flying && st.drone) {
        const ahead = jHold ?? Math.max(jMin, alongRoad(droneAt(st.drone, st.simTime + 2), R.pts, R.cum).along);
        if (ahead < target - 0.5) turnTarget = Math.PI;
        else if (ahead > target + 0.5) turnTarget = 0;
      } else turnTarget = 0;
      // 배속에 맞춰 따라가는 빠르기를 올린다 — 빠른 배속(×20·×60)에서 화면 위치가 100m 넘게 늦어져 갈림길에서 건너뛰던 문제
      if (dt > 0 && lastSim !== null && st.simTime >= lastSim) simRate += ((st.simTime - lastSim) / dt - simRate) * Math.min(1, dt * 2);
      lastSim = st.simTime;
      const fast = Math.max(1, Math.min(15, simRate / 5));
      if (!flying || Math.abs(target - alongDisp) > 400) alongDisp = target;
      else alongDisp += (target - alongDisp) * Math.min(1, dt * 3 * fast);
      const droneAlong = alongDisp;
      const s = 2000 + droneAlong * UPM;
      // 카메라 방향: 가는 쪽 길 방향(되돌아갈 때는 뒤쪽 길 방향 + 180°)을 따라간다.
      // 크게 돌 때(뒤돌기)는 일정한 속도로 돌고, 길 굽이는 바로 따라간다. 늘 짧은 쪽으로 돈다.
      const back = turnTarget > 1 ? -1 : 1;
      let camWant = 0.75 * scene.frame(s + 30 * back).angle + 0.25 * scene.frame(s + 90 * back).angle + (back < 0 ? Math.PI : 0);
      // 갈림길로 되돌아오는 동안: 40m 전부터 미리 그린 우회로 쪽으로 조금씩 돌아, 갈림길에서는 우회로 진행 방향을 본다
      // (갈림길에서 우회선으로 바꾼 뒤 카메라가 보는 방향과 같아 끊기지 않는다)
      if (holdBase && st.fork && st.junctionAlong !== null) {
        const J = st.junctionAlong;
        const w = Math.max(0, Math.min(1, 1 - (droneAlong - J) / 40));
        if (w > 0) {
          const det = st.fork.det;
          const dj = det.junction;
          const detWant = 0.75 * forkDir(det, dj + 30 / UPM) + 0.25 * forkDir(det, dj + 90 / UPM);
          let d = detWant - camWant;
          d -= 2 * Math.PI * Math.round(d / (2 * Math.PI));
          const e = w * w * (3 - 2 * w); // 처음과 끝을 부드럽게
          camWant += d * e;
        }
      }
      if (camDisp === null || !flying) camDisp = camWant;
      else {
        let diff = camWant - camDisp;
        diff -= 2 * Math.PI * Math.round(diff / (2 * Math.PI));
        if (Math.abs(diff) > 1) camDisp += Math.sign(diff) * Math.min(Math.abs(diff), dt * 1.8 * fast);
        else camDisp += diff * Math.min(1, dt * 6 * fast);
      }
      // 순항 때는 조금 높이(넓게), 정찰 때는 낮게 — 카메라 각도는 같음
      zoom += ((st.phase === "transit" ? 0.8 : 1) - zoom) * Math.min(1, dt * 3);
      yieldAmt += ((st.yielding ? 1 : 0) - yieldAmt) * Math.min(1, dt * 1.5);
      const toWy = (alongM: number) => s + (alongM - droneAlong) * UPM;
      const scanning = st.phase === "scan";
      /** 지금 경로(우회 승인 뒤엔 우회로) 위에 있는 지점만 장면에 둔다 — 40m 넘게 떨어지면 null */
      const onRoute = (p: LatLng): number | null => {
        const r = alongRoad(p, R.pts, R.cum);
        return r.dist < 40 ? toWy(r.along) : null;
      };
      const blockAt = st.blockage ? onRoute(st.blockage.pos) : null;
      const blockWy = scanning && st.blockage?.kind === "roadwork" && blockAt !== null ? blockAt : undefined;
      const parkedAt = st.parked.map((pk) => onRoute(pk.sample.position));
      const keepClearWy = scanning
        ? [...parkedAt, st.blockage?.kind === "parking" ? blockAt : null].filter((x): x is number => x !== null)
        : [];
      // 갈림길 근처: 저쪽 길 방향(갈림길에서 저쪽 길 쪽 부채꼴)은 저쪽 경로를 큰길로 둔 장면(sceneO)이 맡는다.
      // 그래야 우회로가 맨 도로가 아니라 길가 건물·보도·차가 있는 거리로 미리 보이고, 갈림길에서 장면을 바꿔도 그대로다
      // (예전에는 갈림길에 닿는 순간 우회로 주변 건물·도로 모습이 통째로 바뀌어 "이상한 길로 가는" 것처럼 보였다).
      // 땅·길·차는 화면을 부채꼴 안팎으로 나눠 각 장면이 칠하고, 건물·나무는 세계 위치로 나눈 뒤 두 장면 것을 섞어 먼 것부터 그린다
      // (화면으로만 자르면 드론 근처 높은 건물이 부채꼴 화면 안으로 크게 덧그려졌다).
      const drawOpts = { s, zoom, t: flying ? now / 1000 : 0, yieldAmt, blockWy, keepClearWy, camAngle: camDisp };
      const fkd = st.fork;
      let v: AerialView;
      if (fkd && flying && Math.abs(droneAlong - fkd.base.junction) < 250) {
        const J = fkd.base.junction;
        const main = onBase ? fkd.base : fkd.det;
        const other = onBase ? fkd.det : fkd.base;
        const thAt = (f: ForkLine, m: number) => f.th[Math.max(0, Math.min(f.th.length - 1, Math.round(m / PATH_STEP_M)))];
        const wrap = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));
        const aO = thAt(other, J + 20);
        const dM = wrap(thAt(main, J + 20) - aO);
        const dB = wrap(thAt(main, J - 20) + Math.PI - aO);
        // 저쪽 길 방향을 가운데 두고, 이쪽 길 남은 방향·들어온 길 방향과의 가운데 선까지
        let a1 = aO + dM / 2;
        let a2 = aO + dB / 2;
        if (Math.sign(dM) === Math.sign(dB)) {
          a1 = aO - 0.9;
          a2 = aO + 0.9;
        }
        const span = wrap(a2 - a1) || 0.01;
        const [jx, jy] = scene.world(0, 2000 + J * UPM);
        const inWedge = (x: number, y: number) => {
          const d = wrap(Math.atan2(x - jx, y - jy) - a1);
          return span > 0 ? d >= 0 && d <= span : d <= 0 && d >= span;
        };
        const ring: [number, number][] = [];
        const ray = (a: number, out: boolean) => {
          const rs = [0, 20, 50, 100, 180, 300, 500, 800, 1300, 2200, 3500];
          for (const r of out ? rs : [...rs].reverse()) ring.push([jx + r * Math.sin(a), jy + r * Math.cos(a)]);
        };
        ray(a1, true);
        for (let k = 1; k < 12; k++) {
          const a = a1 + (span * k) / 12;
          ring.push([jx + 3500 * Math.sin(a), jy + 3500 * Math.cos(a)]);
        }
        ray(a2, false);
        const v0 = scene.view(W, H, s, zoom, 0, camDisp ?? undefined);
        const wedgePath = (c: CanvasRenderingContext2D) => {
          ring.forEach(([x, y], i) => {
            const [px, py] = v0.Mw(x, y);
            if (i === 0) c.moveTo(px, py);
            else c.lineTo(px, py);
          });
          c.closePath();
        };
        const otherSolids: AerialSolid[] = [];
        sceneO.draw(ctx, W, H, {
          ...drawOpts,
          s: 2000 + J * UPM,
          blockWy: undefined,
          keepClearWy: [],
          camXY: scene.world(0, s),
          region: inWedge,
          groundClip: (c) => {
            c.beginPath();
            wedgePath(c);
            c.clip();
          },
          solidsOut: otherSolids,
        });
        v = scene.draw(ctx, W, H, {
          ...drawOpts,
          region: (x, y) => !inWedge(x, y),
          groundClip: (c) => {
            c.beginPath();
            c.rect(0, 0, W, H);
            wedgePath(c);
            c.clip("evenodd");
          },
          extraSolids: otherSolids,
        });
      } else v = scene.draw(ctx, W, H, drawOpts);
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
          const wy = blockAt ?? Number.NaN;
          if (blockAt !== null && visible(wy)) {
            if (st.blockage.kind === "roadwork") {
              // 도로 공사 구간: 파낸 노면 · 줄무늬 바리케이드 · 꼬깔 유도선 · 굴착기
              const quad = (x0: number, x1: number, y0: number, y1: number, fill: string) => {
                const c = [v.M(x0, y0), v.M(x1, y0), v.M(x1, y1), v.M(x0, y1)];
                ctx.fillStyle = fill;
                ctx.beginPath();
                ctx.moveTo(c[0][0], c[0][1]);
                for (let i = 1; i < 4; i++) ctx.lineTo(c[i][0], c[i][1]);
                ctx.closePath();
                ctx.fill();
              };
              quad(LANE * 0.08, LANE * 0.95, wy - 4, wy + 26, "#6b5a45");
              quad(LANE * 0.18, LANE * 0.8, wy + 4, wy + 18, "#4a3d2f");
              // 바리케이드 (주황·흰 줄무늬)
              const bw = (LANE * 0.95 - LANE * 0.05) / 6;
              for (let k = 0; k < 6; k++) quad(LANE * 0.05 + k * bw, LANE * 0.05 + (k + 1) * bw, wy - 10, wy - 7, k % 2 ? "#ffffff" : "#f97316");
              // 꼬깔: 멀리서는 길가에 붙어 있다가 바리케이드에 가까울수록 중앙선 쪽으로 — 차로를 비스듬히 막는 유도선
              for (let k = 0; k < 6; k++) {
                const x = LANE * (0.2 + k * 0.15);
                const y = wy - 14 - k * 9;
                const [cx, cy] = v.M(x, y);
                const kk = v.kAt(x, y);
                ctx.fillStyle = "#f97316";
                ctx.beginPath();
                ctx.moveTo(cx, cy - 2.8 * kk);
                ctx.lineTo(cx + 2.2 * kk, cy + 2.2 * kk);
                ctx.lineTo(cx - 2.2 * kk, cy + 2.2 * kk);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(cx - 1.2 * kk, cy - 0.6 * kk, 2.4 * kk, 0.9 * kk);
              }
              // 굴착기: 노란 차체 + 팔
              quad(LANE * 0.55, LANE * 0.85, wy + 6, wy + 16, "#eab308");
              quad(LANE * 0.6, LANE * 0.75, wy + 8, wy + 13, "#1f2937");
              const [ax, ay] = v.M(LANE * 0.6, wy + 9);
              const [bx, by] = v.M(LANE * 0.35, wy + 12);
              ctx.strokeStyle = "#ca8a04";
              ctx.lineWidth = Math.max(2, 1.6 * v.kAt(LANE * 0.5, wy + 10));
              ctx.beginPath();
              ctx.moveTo(ax, ay);
              ctx.lineTo(bx, by);
              ctx.stroke();
              const [px, py] = v.screen(LANE * 0.5, wy + 4);
              const r = boxR(30 * v.kAt(LANE * 0.5, wy + 4));
              ctx.setLineDash([6, 4]);
              ctx.strokeStyle = "#ff3b3b";
              ctx.lineWidth = 2.5;
              // 상자 위쪽이 화면 밖으로 나가면 화면 안에서 자른다 (위에 붙는 이름표 자리 28px 남김)
              const top = Math.max(28, py - r);
              ctx.strokeRect(px - r, top, r * 2, Math.max(8, py + r - top));
              ctx.setLineDash([]);
              label("도로 공사 · 차로 통제", px - r, top - 24, "rgba(127,29,29,0.92)");
            } else {
              const [px, py] = v.screen(ROAD_HALF - 6, wy);
              const r = boxR(30 * v.kAt(ROAD_HALF - 6, wy));
              ctx.setLineDash([6, 4]);
              ctx.strokeStyle = "#f59e0b";
              ctx.lineWidth = 2.5;
              // 상자 위쪽이 화면 밖으로 나가면 화면 안에서 자른다
              const top = Math.max(4, py - r);
              ctx.strokeRect(px - r, top, r * 2, Math.max(8, py + r - top));
              ctx.setLineDash([]);
              label(st.blockage.short, px - r, py + r + 4, "rgba(120,53,15,0.92)");
            }
          }
        }

        // 진로방해(주정차) 차량 — 도로 오른쪽 가장자리. 인식한 차량이 화면을 벗어나면 인식 결과만 왼쪽 위에 고정
        let lockDrawn = false;
        for (const [pi, pk] of st.parked.entries()) {
          const at = parkedAt[pi];
          if (at === null) continue;
          const wy = at;
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
      ? { text: `다른 진입 경로 안내함 — 드론이 그 길을 앞서 확인 중 (${blk.summary})`, cls: "bg-emerald-700 text-white" }
      : sim.routeChoice === "stay"
        ? { text: `기존 경로 유지 — ${blk.label} · 주차 차량 증거 촬영 중`, cls: "bg-fire text-white" }
        : { text: `진입로 불법주차 확인 — ${blk.label} · 상황실 경로 판단 중`, cls: "bg-fire text-white" }
    : !blk || !(ahead || (phase === "scan" && simTime >= blk.atSec))
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
            {drone.assignment.droneId} · {drone.assignment.role === "guide+detect" ? "정찰+탐지" : "정찰"}
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
