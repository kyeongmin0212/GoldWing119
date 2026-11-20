"use client";

// 드론 투입 판단 카드 — 코드가 계산한 권고를 관제요원이 한 번 눌러 확정

import { CheckCircle2, Plane, Truck } from "lucide-react";
import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";

export default function DispatchDecisionCard({ sim }: { sim: SimController }) {
  const { decision, status, launch } = sim;
  const awaiting = status === "awaiting";
  const n = decision.recommend;

  if (status === "idle") return null;

  if (!awaiting) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-[12px]">
        <CheckCircle2 size={14} className={launch ? "text-drone" : "text-ink-400"} />
        <span className="text-ink-300">투입 결정</span>
        <b className={launch ? "text-drone" : "text-ink-100"}>
          {launch ? `드론 ${n}대 — ${decision.assignments.map((a) => a.droneId).join(", ")}` : "소방차만 출동"}
        </b>
      </div>
    );
  }

  return (
    <div className="slide-in rounded-lg border border-drone/50 bg-ink-850 p-3 shadow-[0_0_0_1px_rgba(34,211,238,0.15),0_8px_30px_rgba(0,0,0,0.4)]">
      <div className="mb-2 flex items-center gap-2">
        <Plane size={16} className="text-drone" />
        <span className="text-[13px] font-bold">드론 투입 판단</span>
        <span className="ml-auto rounded bg-ink-700 px-1.5 py-0.5 text-[10px] text-ink-300">① 출동 경로 탐색 에이전트 · 규칙 계산</span>
      </div>

      <div className="mb-2 grid grid-cols-3 gap-1.5 text-center text-[11px]">
        <div className="rounded bg-ink-900 px-1 py-1.5">
          <div className="text-ink-400">신고 시각</div>
          <div className="font-mono text-[13px]">{decision.reportedAt}</div>
          <div className={decision.rushHour ? "text-truck" : "text-ink-400"}>{decision.rushHour ? "출퇴근" : "평시"}</div>
        </div>
        <div className="rounded bg-ink-900 px-1 py-1.5">
          <div className="text-ink-400">예상 지연</div>
          <div className={`font-mono text-[13px] ${decision.delaySec >= 180 ? "text-alert" : "text-ok"}`}>{formatClock(Math.max(0, decision.delaySec))}</div>
          <div className="text-ink-400">기준 03:00</div>
        </div>
        <div className="rounded bg-ink-900 px-1 py-1.5">
          <div className="text-ink-400">혼잡 DB</div>
          <div className="font-mono text-[13px]">{decision.matches.filter((m) => m.active).length}곳</div>
          <div className="text-ink-400">묶음 {decision.clusters.length}</div>
        </div>
      </div>

      <ul className="mb-2 space-y-0.5 text-[11.5px] text-ink-300">
        {decision.reasons.map((r) => (
          <li key={r}>· {r}</li>
        ))}
      </ul>

      {n > 0 && (
        <div className="mb-2 space-y-1 text-[11.5px]">
          {decision.assignments.map((a) => (
            <div key={a.droneId} className="flex items-center gap-2 rounded bg-ink-900 px-2 py-1">
              <span className="font-mono font-bold text-drone">{a.droneId}</span>
              <span className="text-ink-400">{a.base.name}</span>
              <span className="ml-auto truncate text-ink-100" title={a.cluster.label}>
                → {a.cluster.hotspots[0]?.name ?? a.cluster.label}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        {n > 0 ? (
          <>
            <button
              onClick={() => sim.confirmDispatch(true)}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-drone py-2 text-[13px] font-bold text-ink-950 hover:brightness-110"
            >
              <Plane size={15} /> 드론 투입 승인 ({n}대)
            </button>
            <button
              onClick={() => sim.confirmDispatch(false)}
              className="flex items-center gap-1 rounded-md bg-ink-700 px-3 py-2 text-[12px] hover:bg-ink-600"
            >
              <Truck size={14} /> 소방차만
            </button>
          </>
        ) : (
          <button
            onClick={() => sim.confirmDispatch(false)}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-ink-700 py-2 text-[13px] font-bold hover:bg-ink-600"
          >
            <Truck size={15} /> 확인 — 소방차만 출동
          </button>
        )}
      </div>
    </div>
  );
}
