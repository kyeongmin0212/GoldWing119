"use client";

// 선행 드론 FPV(하향 카메라) 시뮬레이터 — 바운딩 박스, 번호판 OCR, 길터주기 방송 상태 표시 (Canvas)

import { useEffect, useRef } from "react";
import { Video } from "lucide-react";
import { formatClock, formatLatLng } from "@/lib/geo";
import { droneAt, type DroneSim } from "@/lib/simulation";
import type { SimController } from "@/lib/useGoldenTimeSim";
import type { ViolationRecord, ViolationSample } from "@/types/drone";

type Phase = "standby" | "nodrone" | "prep" | "transit" | "scan";

interface FrameState {
  phase: Phase;
  drone: DroneSim | null;
  simTime: number;
  speedMult: number;
  lockTarget: (ViolationSample & { record?: ViolationRecord }) | null;
  approach: { v: ViolationSample; ratio: number } | null;
  role: string;
}

function rand(i: number) {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.fillRect(x + 3, y + 4, w, h);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.fill();
  ctx.fillStyle = "rgba(20,30,45,0.85)";
  ctx.fillRect(x + 3, y + h * 0.18, w - 6, h * 0.2);
  ctx.fillRect(x + 3, y + h * 0.68, w - 6, h * 0.14);
}

export default function DroneVisionFeed({ sim }: { sim: SimController }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
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

  stateRef.current = {
    phase,
    drone,
    simTime,
    speedMult: speed,
    lockTarget,
    approach,
    role: drone?.assignment.role ?? "",
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const ctx = canvas.getContext("2d")!;
    let raf = 0;
    let scroll = 0;
    let last = performance.now();
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

      // 배경: 건물 블록
      ctx.fillStyle = "#0c1118";
      ctx.fillRect(0, 0, W, H);
      const scale = st.phase === "transit" ? 0.55 : 1; // 순항 고도는 더 높게 보임
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
      // 보도
      ctx.fillStyle = "#222b38";
      ctx.fillRect(roadX - 14 * scale, 0, 14 * scale, H);
      ctx.fillRect(roadX + roadW, 0, 14 * scale, H);
      // 도로
      ctx.fillStyle = "#1a1f27";
      ctx.fillRect(roadX, 0, roadW, H);
      // 차선
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

      // 주행 차량 (정체 시 촘촘)
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
            // 길터주기: 정찰 중이면 차량이 우측 차선으로 비켜섬
            const yieldShift = st.phase === "scan" && li === 1 ? roadW * 0.08 : 0;
            const colors = ["#cbd5e1", "#475569", "#1e3a8a", "#7f1d1d", "#e5e7eb", "#334155"];
            drawCar(ctx, lx + yieldShift, y, carW, carH, colors[Math.floor(rand(k + 7) * colors.length)]);
          }
        });
      }

      // 위반 차량 (접근 중 / 락온)
      const targetX = roadX + roadW - carW - 6;
      const drawTarget = (sample: ViolationSample, y: number, locked: boolean, record?: ViolationRecord) => {
        drawCar(ctx, targetX, y, carW * 1.05, carH * 1.05, sample.vehicleType.includes("트럭") ? "#94a3b8" : sample.vehicleType.includes("흰") ? "#f1f5f9" : "#52525b");
        if (!locked) return;
        const pad = 8;
        const bx = targetX - pad;
        const by = y - pad;
        const bw = carW * 1.05 + pad * 2;
        const bh = carH * 1.05 + pad * 2;
        const pulse = 0.6 + 0.4 * Math.sin(now / 180);
        ctx.strokeStyle = `rgba(255,59,59,${pulse})`;
        ctx.lineWidth = 2.5;
        ctx.strokeRect(bx, by, bw, bh);
        // 코너 브래킷
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
        // OCR 라벨 (타이핑 효과)
        const lk = lockStartRef.current;
        if (!lk || lk.id !== sample.id) lockStartRef.current = { id: sample.id, at: now };
        const elapsed = (now - (lockStartRef.current?.at ?? now)) / 1000;
        const plate = sample.plate;
        const shown = plate.slice(0, Math.min(plate.length, Math.floor(elapsed * 8)));
        const lx = Math.max(4, bx - 150);
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
          record?.status === "submitted" ? "지자체 통보 완료" : record?.status === "pending" ? "신고 대기 (승인 필요)" : record?.status === "dismissed" ? "무시됨" : "에이전트 분석 중…";
        ctx.fillStyle = record?.status === "submitted" ? "#6ee7b7" : "#fde68a";
        ctx.fillText(stLabel, lx + 8, ly + 51);
      };
      if (st.lockTarget) drawTarget(st.lockTarget, H * 0.42, true, st.lockTarget.record);
      else if (st.approach) drawTarget(st.approach.v, H * 0.42 - st.approach.ratio * H * 0.6, false);

      // 카메라 질감: 비네트 + 스캔라인
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.65)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      for (let y = (now / 40) % 4; y < H; y += 4) ctx.fillRect(0, y, W, 1);

      // HUD
      ctx.strokeStyle = "rgba(34,211,238,0.7)";
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

      ctx.font = "11px ui-monospace, Consolas, monospace";
      ctx.fillStyle = "rgba(165,243,252,0.9)";
      const spd = st.phase === "transit" ? 54 : st.phase === "scan" ? (hovering ? 0 : 28) : 0;
      const alt = st.phase === "transit" ? 120 : st.phase === "scan" ? 45 : 0;
      ctx.fillText(`ALT ${alt}m  SPD ${spd}km/h`, 10, H - 28);
      if (st.drone) {
        ctx.fillText(`GPS ${formatLatLng(droneAt(st.drone, st.simTime))}`, 10, H - 12);
      }
      if (st.phase !== "standby" && st.phase !== "nodrone") {
        ctx.fillStyle = Math.floor(now / 600) % 2 ? "#ff3b3b" : "rgba(255,59,59,0.3)";
        ctx.beginPath();
        ctx.arc(W - 46, 18, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#fecaca";
        ctx.fillText("REC", W - 38, 22);
      }

      // 대기/미투입 오버레이
      if (st.phase === "standby" || st.phase === "nodrone" || st.phase === "prep") {
        ctx.fillStyle = "rgba(7,11,18,0.72)";
        ctx.fillRect(0, 0, W, H);
        ctx.textAlign = "center";
        ctx.fillStyle = "#93a3b8";
        ctx.font = "bold 14px sans-serif";
        const msg =
          st.phase === "standby" ? "드론 대기 — 출동 지령 대기 중" : st.phase === "nodrone" ? "드론 미투입 — 투입 불필요 판정" : "이륙 준비 중…";
        ctx.fillText(msg, W / 2, H / 2 - 4);
        ctx.font = "11px sans-serif";
        ctx.fillStyle = "#6b7d96";
        const sub =
          st.phase === "standby"
            ? "혼잡 경로일 때만 1~2대 투입"
            : st.phase === "nodrone"
              ? "소방차 단독 출동 · 드론 풀 대기 유지"
              : `이륙 예정 T+${formatClock((st.drone?.launchSec ?? 0) + 30)}`;
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
  const banner =
    broadcasting
      ? { text: "[길터주기 LED·음성 경고 송출 중]", cls: "bg-alert/90 text-white blink" }
      : phase === "scan"
        ? { text: "정찰·탐지 중 — 방송은 소방차 도착 3분 전부터", cls: "bg-amber-500/20 text-amber-300" }
      : phase === "transit"
        ? { text: "직선 비행 중 — 비행금지구역 회피 경로", cls: "bg-drone/20 text-drone" }
        : phase === "prep"
          ? { text: "이륙 준비", cls: "bg-ink-700 text-ink-300" }
          : null;

  return (
    <section className="panel flex min-h-[320px] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <Video size={14} className="text-drone" />
        <span className="panel-title">선행 드론 FPV · 비전 탐지</span>
        <div className="ml-auto flex gap-1">
          {plan.drones.length > 1 &&
            launch &&
            plan.drones.map((d) => (
              <button
                key={d.assignment.droneId}
                onClick={() => sim.setFocusDrone(d.assignment.droneId)}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  drone?.assignment.droneId === d.assignment.droneId ? "bg-drone/25 text-drone" : "bg-ink-800 text-ink-400 hover:text-ink-100"
                }`}
              >
                {d.assignment.droneId}
              </button>
            ))}
        </div>
      </div>
      <div ref={wrapRef} className="relative min-h-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0" aria-label="드론 FPV 시뮬레이션 화면" />
        {banner && (
          <div className={`absolute left-2 right-2 top-2 rounded px-2 py-1 text-center text-[12px] font-bold ${banner.cls}`}>{banner.text}</div>
        )}
        {drone && launch && phase === "scan" && (
          <div className="absolute bottom-[68px] right-2 rounded bg-ink-950/70 px-1.5 py-0.5 text-[9.5px] text-ink-300">
            촬영 고지 중 · 얼굴 블러 · OCR 최소 보관
          </div>
        )}
        {drone && launch && (
          <div className="absolute bottom-12 right-2 rounded bg-ink-950/70 px-1.5 py-0.5 font-mono text-[10px] text-drone">
            CAM-1 · {drone.assignment.droneId} · {drone.assignment.role === "guide+detect" ? "유도+탐지" : "유도"}
          </div>
        )}
      </div>
      {drone && launch && (
        <div className="grid grid-cols-2 gap-px border-t border-ink-700 bg-ink-700 text-[11px]">
          <div className="bg-ink-900 px-2.5 py-1.5">
            <div className="text-ink-400">담당 구간</div>
            <div className="truncate text-ink-100" title={drone.assignment.cluster.label}>
              {drone.assignment.cluster.label}
            </div>
          </div>
          <div className="bg-ink-900 px-2.5 py-1.5">
            <div className="text-ink-400">소방차 대비 선행</div>
            <div className="font-mono text-ok">{formatClock(drone.leadSec)}</div>
          </div>
        </div>
      )}
    </section>
  );
}
