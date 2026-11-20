"use client";

// 전방 차단 → 우회로 안내 판단 — 선행 드론이 소방차 경로를 따라 정찰하다 막힌 곳을 보면,
// 코드가 기존 경로 유지 / 우회 도착 시간을 비교하고 관제요원이 한 번 눌러 소방차 화면에 안내한다.

import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";

export default function RerouteCard({ sim }: { sim: SimController }) {
  const { plan, status, routeChoice, simTime } = sim;
  const b = plan.blockage;
  if (!b || simTime < b.atSec || (status !== "rerouting" && !routeChoice)) return null;
  const deciding = status === "rerouting";

  return (
    <div className={`box ${deciding ? "border-fire" : ""}`}>
      <div className="box-head">
        전방 차단 · 우회로 안내
        <span className="tag ml-auto text-muted">경로 탐색 에이전트 · 규칙 계산</span>
        {!deciding && <span className={`tag ${routeChoice === "detour" ? "text-ok" : "text-muted"}`}>{routeChoice === "detour" ? "우회로 안내함" : "기존 경로 유지"}</span>}
      </div>
      <div className="p-3">
        <table className="kv">
          <tbody>
            <tr>
              <th>발견</th>
              <td>
                <b className="text-fire">{b.label}</b>
                <span className="text-muted"> — {b.droneId} 선행 정찰 영상 · T+{formatClock(b.atSec)}</span>
              </td>
            </tr>
            <tr>
              <th>기존 경로</th>
              <td>
                그대로 지나가면 현장 도착 <b className="font-mono">T+{formatClock(b.stayArrivalSec)}</b>
              </td>
            </tr>
            <tr>
              <th>권장 우회로</th>
              <td>
                {b.summary}
                <div>
                  현장 도착 <b className="font-mono text-ok">T+{formatClock(b.detourArrivalSec)}</b> · <b className="text-ok">{formatClock(b.savedSec)} 단축</b>
                </div>
              </td>
            </tr>
            <tr>
              <th>판단 시한</th>
              <td>
                소방차가 갈림길에 닿기 전 <span className="font-mono">T+{formatClock(b.decideBySec)}</span>
              </td>
            </tr>
          </tbody>
        </table>
        {deciding && (
          <div className="mt-3 flex gap-2">
            <button className="btn btn-primary flex-1" onClick={() => sim.chooseRoute("detour")}>
              우회로 안내 승인
            </button>
            <button className="btn" onClick={() => sim.chooseRoute("stay")}>
              기존 경로 유지
            </button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">도착 시간은 가정 속도 기준입니다. 드론은 원격 조종자가 조종하며, 소방차 경로를 따라 앞서 비행하며 확인합니다.</p>
      </div>
    </div>
  );
}
