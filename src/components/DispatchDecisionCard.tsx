"use client";

// 드론 투입 판단 — 코드가 계산한 권고를 관제요원이 한 번 눌러 확정

import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";

export default function DispatchDecisionCard({ sim }: { sim: SimController }) {
  const { decision, status, launch } = sim;
  const awaiting = status === "awaiting";
  const n = decision.recommend;
  if (status === "idle") {
    return <p className="px-1 py-6 text-center text-[13px] text-muted">[출동 시나리오 시작]을 누르면 드론 투입 판단이 여기에 나옵니다.</p>;
  }

  const active = decision.matches.filter((m) => m.active);
  return (
    <div className="box">
      <div className="box-head">
        드론 투입 판단
        <span className="tag ml-auto text-muted">경로 탐색 에이전트 · 규칙 계산</span>
        {!awaiting && <span className={`tag ${launch ? "text-drone" : "text-muted"}`}>{launch ? `드론 ${n}대 출동` : "소방차만 출동"}</span>}
      </div>
      <div className="p-3">
        {/* 승인 버튼은 카드 맨 위 — 노트북 화면에서도 스크롤 없이 보이게 (우회로 카드와 같은 배치) */}
        {awaiting && (
          <div className="mb-3 flex gap-2">
            {n > 0 ? (
              <>
                <button className="btn btn-primary flex-1" onClick={() => sim.confirmDispatch(true)}>
                  드론 투입 승인 ({n}대)
                </button>
                <button className="btn" onClick={() => sim.confirmDispatch(false)}>
                  소방차만 출동
                </button>
              </>
            ) : (
              <button className="btn btn-primary flex-1" onClick={() => sim.confirmDispatch(false)}>
                확인 — 소방차만 출동
              </button>
            )}
          </div>
        )}
        <table className="kv">
          <tbody>
            <tr>
              <th>신고 시각</th>
              <td>
                {decision.reportedAt} · {decision.rushHour ? "출퇴근 시간대" : "평시 시간대"}
              </td>
            </tr>
            <tr>
              <th>예상 지연</th>
              <td>
                <b className={decision.delaySec >= 180 ? "text-fire" : "text-ok"}>{formatClock(Math.max(0, decision.delaySec))}</b>
                <span className="text-muted"> (평시 {formatClock(decision.normalSec)} → 예상 {formatClock(decision.expectedSec)}, 기준 3분)</span>
              </td>
            </tr>
            <tr>
              <th>혼잡 지점</th>
              <td>{active.length ? active.map((m) => m.hotspot.name).join(", ") : "경로상 활성 혼잡 지점 없음"}</td>
            </tr>
            <tr>
              <th>권고</th>
              <td>
                <b>{n ? `드론 ${n}대 투입` : "투입 불필요"}</b>
                <span className="text-muted"> — {decision.reasons[decision.reasons.length - 1].replace(/^→\s*/, "")}</span>
              </td>
            </tr>
            {n > 0 && (
              <tr>
                <th>배정</th>
                <td>
                  {decision.assignments.map((a) => (
                    <div key={a.droneId}>
                      <b className="font-mono text-drone">{a.droneId}</b> {a.base.name} → {a.cluster.hotspots[0]?.name ?? a.cluster.label}
                    </div>
                  ))}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
