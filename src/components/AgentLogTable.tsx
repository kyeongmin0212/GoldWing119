"use client";

// 에이전트 판단 기록 — 표 형식 (시각 | 담당 | 내용)

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { formatClock } from "@/lib/geo";
import type { AgentLog, AgentName } from "@/types/drone";

export const AGENT_LABEL: Record<AgentName, { label: string; color: string }> = {
  route: { label: "경로 탐색", color: "#5b3fa0" },
  pathfinder: { label: "선행 유도", color: "#1d4ed8" },
  vision: { label: "비전 단속", color: "#c8102e" },
  report: { label: "행정 통보", color: "#1f3a68" },
  watsonx: { label: "watsonx", color: "#1f3a68" },
  system: { label: "시스템", color: "#5b6576" },
};

export default function AgentLogTable({ logs, busyAgent }: { logs: AgentLog[]; busyAgent: AgentName | null }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs.length, busyAgent]);

  return (
    <div ref={ref} className="scroll-thin h-full overflow-y-auto">
      {logs.length === 0 ? (
        <p className="px-3 py-6 text-center text-[13px] text-muted">아직 기록이 없습니다.</p>
      ) : (
        <table className="w-full border-collapse text-[12.5px]">
          <thead className="sticky top-0 bg-subtle text-left text-[11px] text-muted">
            <tr>
              <th className="w-[58px] border-b border-line px-2 py-1.5 font-semibold">시각</th>
              <th className="w-[72px] border-b border-line px-2 py-1.5 font-semibold">담당</th>
              <th className="border-b border-line px-2 py-1.5 font-semibold">내용</th>
            </tr>
          </thead>
          <tbody>
            {logs.map((l) => {
              const a = AGENT_LABEL[l.agent];
              return (
                <tr key={l.id} className={l.level === "warn" ? "bg-slow-soft" : undefined}>
                  <td className="border-b border-line px-2 py-1.5 align-top font-mono text-faint">{formatClock(l.simTime)}</td>
                  <td className="border-b border-line px-2 py-1.5 align-top font-semibold" style={{ color: a.color }}>
                    {a.label}
                  </td>
                  <td className="border-b border-line px-2 py-1.5 align-top">
                    {l.text}
                    {l.sources && l.sources.length > 0 && <div className="mt-0.5 text-[11px] text-muted">근거 문서: {l.sources.join(", ")}</div>}
                  </td>
                </tr>
              );
            })}
            {busyAgent && (
              <tr>
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 font-semibold" style={{ color: AGENT_LABEL[busyAgent].color }}>
                  {AGENT_LABEL[busyAgent].label}
                </td>
                <td className="px-2 py-1.5 text-muted">
                  <Loader2 size={12} className="mr-1 inline animate-spin" />
                  처리 중
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
