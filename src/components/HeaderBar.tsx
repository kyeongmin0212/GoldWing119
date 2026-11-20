"use client";

// 상황실 콘솔 상단: 시스템 바 · 사건 제어 · 요약 표

import { useEffect, useState } from "react";
import { ExternalLink, Pause, Play, RotateCcw } from "lucide-react";
import { DRONE_BASES, DRONE_POOL_TOTAL } from "@/data/droneBases";
import { SCENARIOS, SCENARIO_ORDER } from "@/data/scenarioData";
import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";

const MODE_LABEL = { regional: "1 · 도로 막힘 → 빠른 길", urban: "2 · 불법주차 → 다른 경로" } as const;

function useNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export default function HeaderBar({ sim }: { sim: SimController }) {
  const { status, mode, backend, activeDrones, simTime, speed, scenario, violations, plan, launch } = sim;
  const now = useNow();
  const running = status === "running";
  const pending = violations.filter((v) => v.status === "pending" || v.status === "analyzing").length;

  return (
    <header>
      {/* 시스템 바 */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-navy px-4 py-2 text-white">
        <div className="flex items-baseline gap-2">
          <b className="text-[16px] tracking-tight">G-J 골든타임 윙</b>
          <span className="text-[13px] text-white/75">긴급출동 선행 드론 관제</span>
        </div>
        <span className="text-[12px] text-white/70">119 종합상황실 · 1번 콘솔 (관제요원·원격 조종자)</span>
        <div className="ml-auto flex items-center gap-3 text-[12px]">
          <span className="border border-white/50 px-1.5 py-0.5" title={backend === "live" ? "IBM watsonx Orchestrate 실연동" : "내장 시뮬레이션 에이전트"}>
            watsonx Orchestrate {backend === "live" ? "연결됨" : backend === "mock" ? "시뮬레이션" : "확인 중"}
          </span>
          <span className="font-mono text-white/85">{now ? now.toLocaleString("ko-KR", { hour12: false }) : ""}</span>
          <button
            className="flex items-center gap-1 border border-white/60 px-2 py-0.5 hover:bg-white/10"
            onClick={() => window.open("/crew", "gj-crew", "width=1180,height=820")}
            title="같은 브라우저의 새 창에 소방차 태블릿 화면을 엽니다"
          >
            <ExternalLink size={13} /> 소방차 화면 열기
          </button>
        </div>
      </div>

      {/* 사건 제어 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-4 py-2">
        <span className="text-[12px] font-semibold text-muted">시나리오</span>
        <div className="flex" role="group" aria-label="시나리오 선택">
          {SCENARIO_ORDER.map((m) => (
            <button
              key={m}
              onClick={() => sim.changeMode(m)}
              title={SCENARIOS[m].description}
              className={`-ml-px border px-3 py-1.5 text-[13px] first:ml-0 ${mode === m ? "z-10 border-navy bg-navy-soft font-semibold text-navy" : "border-line bg-white text-muted hover:bg-subtle"}`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <span className="ml-2 truncate text-[13px] text-text" title={scenario.title}>
          {scenario.incident.reportedAt} 신고 · {scenario.incident.name}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <span className="font-mono text-[14px] tabular-nums" aria-label="경과 시간">
            T+{formatClock(simTime)}
          </span>
          <button className={`btn ${running ? "" : "btn-fire"}`} onClick={running ? sim.pause : sim.start} disabled={status === "awaiting" || status === "rerouting"}>
            {running ? <Pause size={15} /> : <Play size={15} />}
            {running ? "일시정지" : status === "awaiting" ? "투입 판단 대기" : status === "rerouting" ? "우회로 판단 대기" : status === "paused" ? "재개" : status === "finished" ? "다시 시작" : "출동 시나리오 시작"}
          </button>
          <button className="btn" onClick={sim.reset}>
            <RotateCcw size={14} /> 초기화
          </button>
          <label className="flex items-center gap-1 text-[12px] text-muted">
            배속
            <select value={speed} onChange={(e) => sim.setSpeed(Number(e.target.value))} className="h-[34px] border border-line-strong bg-white px-1.5 text-[13px] text-text" aria-label="재생 배속">
              {[10, 20, 30, 60].map((s) => (
                <option key={s} value={s}>
                  ×{s}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {/* 요약 표 */}
      <div className="grid grid-cols-2 border-b border-line bg-white text-[13px] sm:grid-cols-5">
        {[
          ["진행 상태", status === "idle" ? "대기" : status === "awaiting" ? "투입 판단 대기" : status === "rerouting" ? "우회로 판단 대기" : status === "running" ? "출동 중" : status === "paused" ? "일시정지" : "현장 도착"],
          ["투입 드론", `${activeDrones}대`],
          ["거점 대기 드론", `${DRONE_POOL_TOTAL - activeDrones} / ${DRONE_POOL_TOTAL}대 (시범 ${DRONE_BASES.length}거점)`],
          ["통보 초안", `${pending}건`],
          ["소방차 도착 예정", status === "idle" ? "—" : `T+${formatClock(plan.truck.totalSec)}${launch === false ? " (드론 미투입)" : ""}`],
        ].map(([k, v]) => (
          <div key={k} className="border-r border-line px-4 py-2 last:border-r-0">
            <div className="text-[11px] text-muted">{k}</div>
            <div className="font-semibold">{v}</div>
          </div>
        ))}
      </div>
    </header>
  );
}
