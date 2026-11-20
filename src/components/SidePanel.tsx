"use client";

// 상황실 오른쪽 탭: 사건 처리 | 에이전트 기록 | 질의

import { useEffect, useState } from "react";
import AgentLogTable from "@/components/AgentLogTable";
import DispatchDecisionCard from "@/components/DispatchDecisionCard";
import QueryPanel from "@/components/QueryPanel";
import RerouteCard from "@/components/RerouteCard";
import ViolationAlertCard from "@/components/ViolationAlertCard";
import type { SimController } from "@/lib/useGoldenTimeSim";

type Tab = "case" | "log" | "query";

export default function SidePanel({ sim }: { sim: SimController }) {
  const [tab, setTab] = useState<Tab>("case");
  const pending = sim.violations.filter((v) => v.status === "pending").length;

  // 판단·승인이 필요한 일이 생기면 사건 처리 탭으로
  useEffect(() => {
    if (sim.status === "awaiting" || sim.status === "rerouting") setTab("case");
  }, [sim.status]);
  useEffect(() => {
    if (sim.violations.length) setTab("case");
  }, [sim.violations.length]);

  const tabs: [Tab, string][] = [
    ["case", `사건 처리${pending ? ` (초안 검토 ${pending})` : ""}`],
    ["log", `에이전트 기록 (${sim.logs.length})`],
    ["query", "질의"],
  ];

  return (
    <section className="box flex min-h-[320px] flex-1 flex-col overflow-hidden">
      <div className="flex border-b border-line bg-subtle" role="tablist">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={`-mb-px border-b-2 px-4 py-2 text-[13px] ${tab === k ? "border-navy bg-white font-bold text-navy" : "border-transparent text-muted hover:text-text"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1">
        {tab === "case" && (
          <div className="scroll-thin h-full space-y-3 overflow-y-auto p-3">
            <RerouteCard sim={sim} />
            <DispatchDecisionCard sim={sim} />
            <ViolationAlertCard sim={sim} />
          </div>
        )}
        {tab === "log" && <AgentLogTable logs={sim.logs} busyAgent={sim.busyAgent} />}
        {tab === "query" && <QueryPanel sim={sim} />}
      </div>
    </section>
  );
}
