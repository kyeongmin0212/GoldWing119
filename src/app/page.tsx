"use client";

// 119 종합상황실 콘솔 — 출동 상황도(왼쪽) · 드론 영상과 사건 처리(오른쪽)
// 소방차 태블릿 화면은 /crew (같은 상태를 실시간으로 공유받아 보기 전용으로 표시)

import DroneVisionFeed from "@/components/DroneVisionFeed";
import HeaderBar from "@/components/HeaderBar";
import SidePanel from "@/components/SidePanel";
import TacticalMap from "@/components/TacticalMap";
import { useGoldenTimeSim } from "@/lib/useGoldenTimeSim";

export default function ConsolePage() {
  const sim = useGoldenTimeSim();
  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <HeaderBar sim={sim} />
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
        <section className="box flex min-h-[420px] flex-col overflow-hidden">
          <div className="box-head">
            출동 상황도
            <span className="ml-auto text-[11px] font-normal text-muted">구역·지점은 개략/가상 (시연용) · 지도 OpenStreetMap</span>
          </div>
          <div className="relative min-h-0 flex-1">
            <TacticalMap sim={sim} />
          </div>
        </section>
        <div className="flex min-h-0 flex-col gap-3">
          <div className="h-[360px] shrink-0 lg:h-[55%]">
            <DroneVisionFeed sim={sim} />
          </div>
          <SidePanel sim={sim} />
        </div>
      </main>
    </div>
  );
}
