"use client";

// 소방차 태블릿 화면 — 상황실 콘솔의 상태를 BroadcastChannel 로 실시간 공유받아 보기 전용으로 표시
// 드론은 대원이 조종하지 않는다(거점 자동 비행 + 상황실 원격 조종자 감독). 대원은 영상과 전방 상황만 본다.

import { useEffect, useMemo, useState } from "react";
import CrewStatusPanel from "@/components/CrewStatusPanel";
import DroneVisionFeed from "@/components/DroneVisionFeed";
import TacticalMap from "@/components/TacticalMap";
import { HOTSPOTS } from "@/data/congestionDb";
import { DRONE_BASES } from "@/data/droneBases";
import { CONTROL_ZONES, NO_FLY_ZONES } from "@/data/noFlyZones";
import { SCENARIOS } from "@/data/scenarioData";
import { decideDispatch } from "@/lib/dispatch";
import { formatClock } from "@/lib/geo";
import { useSimSubscriber } from "@/lib/simBridge";
import { buildSimPlan } from "@/lib/simulation";
import type { SimView } from "@/lib/simView";

const noop = () => {};

export default function CrewPage() {
  const { snap, connected } = useSimSubscriber();
  const [now, setNow] = useState(() => Date.now());
  const [focus, setFocus] = useState<string | null>(null);

  // 받은 시각 사이를 부드럽게 보간하기 위한 시계
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      setNow(Date.now());
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const mode = snap?.mode ?? "urban";
  const scenario = SCENARIOS[mode];
  const decision = useMemo(() => decideDispatch(scenario, HOTSPOTS, DRONE_BASES), [scenario]);
  const launch = snap?.launch ?? null;
  const plan = useMemo(() => buildSimPlan(scenario, NO_FLY_ZONES, decision, launch === true), [scenario, decision, launch]);

  const simTime = !snap
    ? 0
    : snap.status === "running"
      ? Math.min(plan.endSec, snap.simTime + ((now - snap.sentAt) / 1000) * snap.speed)
      : snap.simTime;

  const view: SimView = {
    mode,
    scenario,
    decision,
    launch,
    plan,
    zones: NO_FLY_ZONES,
    controlZones: CONTROL_ZONES,
    hotspots: HOTSPOTS,
    bases: DRONE_BASES,
    status: snap?.status ?? "idle",
    simTime,
    speed: snap?.speed ?? 30,
    violations: snap?.violations ?? [],
    focusDrone: focus ?? snap?.focusDrone ?? null,
    manualControl: snap?.manualControl ?? null,
    setFocusDrone: setFocus,
    setSelectedId: noop,
  };

  return (
    <div className="flex min-h-screen flex-col lg:h-screen">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1 bg-navy px-4 py-2.5 text-white">
        <b className="text-[18px]">소방차 화면</b>
        <span className="text-[14px] text-white/80">{scenario.station.name} · 출동 차량 (가상)</span>
        <div className="ml-auto flex items-center gap-3 text-[14px]">
          <span className={`border px-2 py-0.5 ${connected ? "border-white/60" : "border-amber-300 text-amber-200"}`}>{connected ? "상황실 연결됨" : "상황실 연결 대기"}</span>
          <span className="font-mono text-[16px]">T+{formatClock(simTime)}</span>
        </div>
      </header>

      {!connected && (
        <div className="border-b border-slow bg-slow-soft px-4 py-2 text-[15px] text-slow">
          상황실 콘솔과 연결되지 않았습니다. 같은 브라우저에서 상황실 화면(/)을 열고 시나리오를 시작하면 이 화면이 자동으로 따라갑니다.
        </div>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className="min-h-[380px]">
          <DroneVisionFeed sim={view} big />
        </div>
        <div className="flex min-h-0 flex-col gap-3">
          <div className="min-h-0 flex-1">
            <CrewStatusPanel sim={view} />
          </div>
          <section className="box flex h-[260px] shrink-0 flex-col overflow-hidden">
            <div className="box-head text-[15px]">경로</div>
            <div className="relative min-h-0 flex-1">
              <TacticalMap sim={view} compact />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
