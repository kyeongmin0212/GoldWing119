"use client";

// 소방차 태블릿 오른쪽 — 운전 중 한눈에 보는 큰 글씨 상태판 (조작 버튼 없음)

import { formatClock, truckAt } from "@/lib/geo";
import { scenarioRoad } from "@/lib/road";
import type { SimView } from "@/lib/simView";

/** 지금 소방차 위치에서 toVertex 경유점까지 남은 실제 도로 거리(km) */
function remainKm(sim: SimView, toVertex: number): number {
  const { plan, simTime, scenario } = sim;
  const { segKm } = scenarioRoad(scenario);
  const t = truckAt(plan.truck, simTime);
  const k = t.segIndex;
  if (k + 1 > toVertex) return 0;
  const t0 = plan.truck.times[k];
  const t1 = plan.truck.times[k + 1] ?? t0;
  const done = t1 > t0 ? Math.max(0, Math.min(1, (simTime - t0) / (t1 - t0))) : 1;
  let km = segKm[k] * (1 - done);
  for (let j = k + 1; j < toVertex; j++) km += segKm[j];
  return km;
}

function Row({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "fire" | "ok" | "drone" | "slow" }) {
  const color = tone === "fire" ? "text-fire" : tone === "ok" ? "text-ok" : tone === "drone" ? "text-drone" : tone === "slow" ? "text-slow" : "text-text";
  return (
    <div className="border-b border-line px-4 py-3 last:border-b-0">
      <div className="text-[14px] text-muted">{label}</div>
      <div className={`mt-0.5 text-[22px] font-bold leading-snug ${color}`}>{children}</div>
    </div>
  );
}

export default function CrewStatusPanel({ sim }: { sim: SimView }) {
  const { plan, simTime, scenario, decision, launch, violations, status } = sim;
  const started = status !== "idle";
  const remainSec = Math.max(0, plan.truck.totalSec - simTime);

  // 지금 통과 중이거나 다음에 만나는 혼잡 구간
  const truckSeg = truckAt(plan.truck, simTime).segIndex;
  const inCluster = decision.clusters.find((c) => truckSeg >= c.firstSeg && truckSeg <= c.lastSeg);
  const nextCluster = decision.clusters.find((c) => c.firstSeg > truckSeg);

  return (
    <div className="box flex h-full flex-col overflow-hidden">
      <div className="box-head text-[16px]">출동 상황</div>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <Row label="현장">{scenario.incident.name}</Row>
        <Row label="현장 도착까지">{started ? `약 ${Math.ceil(remainSec / 60)}분 (T+${formatClock(plan.truck.totalSec)})` : "출동 대기"}</Row>

        {inCluster ? (
          <Row label="지금 통과 중" tone="slow">
            {inCluster.hotspots[0]?.name ?? inCluster.label}
          </Row>
        ) : nextCluster ? (
          <Row label="다음 혼잡 구간" tone="slow">
            {nextCluster.hotspots[0]?.name ?? nextCluster.label}
            <span className="block text-[17px] font-semibold text-text">
              {remainKm(sim, nextCluster.firstSeg).toFixed(1)}km · 약 {Math.max(0, Math.ceil((plan.truck.times[nextCluster.firstSeg] - simTime) / 60))}분 뒤
            </span>
          </Row>
        ) : (
          started && <Row label="혼잡 구간">경로상 남은 혼잡 구간 없음</Row>
        )}

        {launch === false && <Row label="드론">이번 출동은 드론 없이 단독 출동</Row>}
        {launch &&
          plan.drones.map((d) => {
            const id = d.assignment.droneId;
            const where = d.assignment.cluster.hotspots[0]?.name ?? d.assignment.cluster.label;
            let text: string;
            let tone: "fire" | "ok" | "drone" | undefined = "drone";
            if (simTime < d.launchSec + 25) text = `이륙 대기 (T+${formatClock(d.launchSec + 25)} 이륙)`;
            else if (simTime < d.scanStartSec) text = `${where}로 비행 중 · 약 ${Math.ceil((d.scanStartSec - simTime) / 60)}분 뒤 도착`;
            else if (simTime >= d.broadcastSec) {
              text = `${where} 도착 — 길터주기 방송 중`;
              tone = "ok";
            } else text = `${where} 도착 — 정찰·탐지 중`;
            return (
              <Row key={id} label={`드론 ${id} · 원격 조종자 ${plan.drones.indexOf(d) + 1} 조종`} tone={tone}>
                {text}
              </Row>
            );
          })}

        <Row label="진로 방해 차량" tone={violations.length ? "fire" : undefined}>
          {violations.length === 0
            ? "탐지 없음"
            : violations.map((v) => (
                <span key={v.id} className="block text-[18px]">
                  {v.plate} · {v.locationLabel.replace(/^전남광주통합특별시 /, "").replace(/ \(.*\)$/, "")}
                  <span className="ml-2 text-[15px] font-semibold text-muted">
                    {v.status === "submitted" ? "상황실 통보 완료" : v.status === "dismissed" ? "상황실 확인" : "상황실 처리 중"}
                  </span>
                </span>
              ))}
        </Row>
      </div>
    </div>
  );
}
