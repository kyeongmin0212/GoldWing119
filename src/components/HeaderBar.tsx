"use client";

import { Pause, Play, RotateCcw, Radio, Building2, Map as MapIcon, Moon, Gauge } from "lucide-react";
import { DRONE_BASES, DRONE_POOL_TOTAL, STAGE3_TARGET } from "@/data/droneBases";
import { SCENARIOS, SCENARIO_ORDER } from "@/data/scenarioData";
import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";

export default function HeaderBar({ sim }: { sim: SimController }) {
  const { status, mode, backend, activeDrones, simTime, speed } = sim;
  const running = status === "running";

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-ink-700 bg-ink-900/80 px-4 py-2.5 backdrop-blur">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="grid h-8 w-8 place-items-center rounded-md bg-alert/15 text-alert">
          <Radio size={18} />
        </div>
        <div className="min-w-0">
          <h1 className="truncate text-[15px] font-bold tracking-tight">
            G-J 골든타임 윙 <span className="font-normal text-ink-300">— 전남·광주 광역 드론 관제 시스템</span>
          </h1>
          <p className="text-[11px] text-ink-400">{sim.scenario.title}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 rounded-md border border-ink-700 bg-ink-850 px-3 py-1.5 text-[12px]">
        <span className="text-ink-300">시범 {DRONE_BASES.length}거점 · 드론</span>
        <b className="font-mono">{DRONE_POOL_TOTAL}대</b>
        <span className="text-ok">대기 {DRONE_POOL_TOTAL - activeDrones}</span>
        <span className="text-ink-600">/</span>
        <span className="text-alert">출동 {activeDrones}</span>
        <span className="hidden text-[10px] text-ink-400 xl:inline" title="3단계 광역 통합 목표 — 공식 출처 없는 가정값">
          · 3단계 목표 {STAGE3_TARGET}대(가정)
        </span>
      </div>

      <div
        className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
          backend === "live" ? "bg-ibm/20 text-ibm" : "bg-ink-700 text-ink-300"
        }`}
        title={backend === "live" ? "IBM watsonx Orchestrate 실연동" : "내장 시뮬레이션 에이전트 (IBM 연결 정보 미설정 또는 오류)"}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${backend === "live" ? "bg-ibm" : "bg-ink-400"}`} />
        watsonx Orchestrate · {backend === "live" ? "LIVE" : backend === "mock" ? "MOCK" : "확인 중"}
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-2">
        <div className="font-mono text-[13px] tabular-nums text-ink-100" aria-label="시뮬레이션 경과 시간">
          T+{formatClock(simTime)}
        </div>

        <button
          onClick={running ? sim.pause : sim.start}
          disabled={status === "awaiting"}
          className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-60 ${
            running ? "bg-ink-700 hover:bg-ink-600" : "bg-alert text-white hover:brightness-110"
          }`}
        >
          {running ? <Pause size={15} /> : <Play size={15} />}
          {running
            ? "일시정지"
            : status === "awaiting"
              ? "투입 판단 대기"
              : status === "paused"
                ? "재개"
                : status === "finished"
                  ? "다시 시작"
                  : "출동 시나리오 시작"}
        </button>
        <button
          onClick={sim.reset}
          className="flex items-center gap-1.5 rounded-md bg-ink-800 px-3 py-1.5 text-[13px] hover:bg-ink-700"
        >
          <RotateCcw size={14} /> 초기화
        </button>

        <div className="flex overflow-hidden rounded-md border border-ink-700 text-[12px]" role="group" aria-label="시나리오 모드 전환">
          {SCENARIO_ORDER.map((m) => {
            const Icon = m === "urban" ? Building2 : m === "regional" ? MapIcon : Moon;
            return (
              <button
                key={m}
                onClick={() => sim.changeMode(m)}
                title={SCENARIOS[m].description}
                className={`flex items-center gap-1 px-2.5 py-1.5 ${mode === m ? "bg-drone/20 text-drone" : "hover:bg-ink-800"}`}
              >
                <Icon size={13} /> {m === "urban" ? "광주 도심형" : m === "regional" ? "전남-광주 광역형" : "평시 야간"}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-1 text-[12px] text-ink-300">
          <Gauge size={13} />
          <select
            value={speed}
            onChange={(e) => sim.setSpeed(Number(e.target.value))}
            className="rounded bg-ink-800 px-1.5 py-1 text-ink-100 outline-none"
            aria-label="재생 배속"
          >
            {[10, 20, 30, 60].map((s) => (
              <option key={s} value={s}>
                ×{s}
              </option>
            ))}
          </select>
        </label>
      </div>
    </header>
  );
}
