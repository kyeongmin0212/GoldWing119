"use client";

// 4대 에이전트 실시간 추론 로그 + IBM watsonx Orchestrate 챗 (LIVE / MOCK 자동 전환)

import { useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send } from "lucide-react";
import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";
import type { AgentName } from "@/types/drone";

const AGENTS: { key: AgentName; no: string; name: string; color: string }[] = [
  { key: "route", no: "①", name: "경로 탐색", color: "#a78bfa" },
  { key: "pathfinder", no: "②", name: "선행 유도", color: "#22d3ee" },
  { key: "vision", no: "③", name: "비전 단속", color: "#f87171" },
  { key: "report", no: "④", name: "행정 신고", color: "#4589ff" },
];

const META: Record<AgentName, { label: string; color: string }> = {
  route: { label: "① 경로탐색", color: "#a78bfa" },
  pathfinder: { label: "② 선행유도", color: "#22d3ee" },
  vision: { label: "③ 비전단속", color: "#f87171" },
  report: { label: "④ 행정신고", color: "#4589ff" },
  watsonx: { label: "watsonx", color: "#4589ff" },
  system: { label: "시스템", color: "#93a3b8" },
};

const QUICK = ["소화전 5m 규정 근거는?", "이 차량 과태료 얼마야?", "비행금지구역은 어떻게 피해?"];

export default function IbmAgentPanel({ sim }: { sim: SimController }) {
  const { logs, busyAgent, backend } = sim;
  const listRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, busyAgent]);

  const lastBy = (k: AgentName) => [...logs].reverse().find((l) => l.agent === k);

  const send = (msg: string) => {
    const m = msg.trim();
    if (!m) return;
    setText("");
    void sim.chat(m);
  };

  return (
    <section className="panel flex min-h-[340px] flex-1 flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b border-ink-700 px-3 py-2">
        <Bot size={14} className="text-ibm" />
        <span className="panel-title">IBM 에이전트 추론 로그</span>
        <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold ${backend === "live" ? "bg-ibm/20 text-ibm" : "bg-ink-700 text-ink-300"}`}>
          {backend === "live" ? "Orchestrate LIVE" : "MOCK 시뮬레이션"}
        </span>
      </div>

      {/* 에이전트 파이프라인 상태 */}
      <div className="grid grid-cols-4 gap-1 border-b border-ink-700 px-2 py-2">
        {AGENTS.map((a) => {
          const busy = busyAgent === a.key;
          const used = !!lastBy(a.key);
          return (
            <div
              key={a.key}
              className="rounded px-1 py-1 text-center text-[10px] leading-tight transition"
              style={{
                background: busy ? `${a.color}33` : used ? `${a.color}14` : "transparent",
                border: `1px solid ${busy ? a.color : used ? `${a.color}55` : "#1d2a3e"}`,
                color: used || busy ? a.color : "#6b7d96",
              }}
            >
              <div className="font-bold">
                {a.no} {busy && <Loader2 size={9} className="inline animate-spin" />}
              </div>
              {a.name}
            </div>
          );
        })}
      </div>

      <div ref={listRef} className="scroll-thin min-h-0 flex-1 space-y-1 overflow-y-auto px-2.5 py-2 font-mono text-[11px] leading-snug">
        {logs.length === 0 && <div className="pt-6 text-center font-sans text-[12px] text-ink-400">[출동 시나리오 시작]을 누르면 에이전트 판단 로그가 실시간으로 흐릅니다.</div>}
        {logs.map((l) => {
          const m = META[l.agent];
          return (
            <div key={l.id} className="slide-in flex gap-1.5">
              <span className="shrink-0 text-ink-600">{formatClock(l.simTime)}</span>
              <span className="shrink-0 font-semibold" style={{ color: m.color }}>
                {m.label}
              </span>
              <span
                className={
                  l.level === "warn" ? "text-amber-300" : l.level === "success" ? "text-ink-100" : l.level === "progress" ? "text-ink-300" : "text-ink-300"
                }
              >
                {l.text}
              </span>
            </div>
          );
        })}
        {busyAgent && (
          <div className="flex items-center gap-1.5 text-ink-400">
            <Loader2 size={11} className="animate-spin" /> {META[busyAgent].label} 처리 중…
          </div>
        )}
      </div>

      <div className="border-t border-ink-700 p-2">
        <div className="mb-1.5 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button key={q} onClick={() => send(q)} className="rounded-full bg-ink-800 px-2 py-0.5 text-[10.5px] text-ink-300 hover:bg-ink-700 hover:text-ink-100">
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="flex gap-1.5"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="watsonx 에이전트에게 질문…"
            className="min-w-0 flex-1 rounded-md border border-ink-700 bg-ink-950 px-2.5 py-1.5 text-[12px] outline-none focus:border-ibm"
          />
          <button type="submit" className="rounded-md bg-ibm px-2.5 text-white hover:brightness-110" aria-label="보내기">
            <Send size={14} />
          </button>
        </form>
      </div>
    </section>
  );
}
