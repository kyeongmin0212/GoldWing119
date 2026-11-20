"use client";

// 메인 3단 전술 관제 대시보드 (지도 50% · FPV 25% · 에이전트 25%)

import HeaderBar from "@/components/HeaderBar";
import TacticalMap from "@/components/TacticalMap";
import DroneVisionFeed from "@/components/DroneVisionFeed";
import DispatchDecisionCard from "@/components/DispatchDecisionCard";
import ViolationAlertCard from "@/components/ViolationAlertCard";
import IbmAgentPanel from "@/components/IbmAgentPanel";
import { useGoldenTimeSim } from "@/lib/useGoldenTimeSim";

export default function Page() {
  const sim = useGoldenTimeSim();
  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <HeaderBar sim={sim} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-2 p-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <TacticalMap sim={sim} />
        <DroneVisionFeed sim={sim} />
        <div className="scroll-thin flex min-h-0 flex-col gap-2 lg:overflow-y-auto">
          <DispatchDecisionCard sim={sim} />
          <ViolationAlertCard sim={sim} />
          <IbmAgentPanel sim={sim} />
        </div>
      </main>
    </div>
  );
}
