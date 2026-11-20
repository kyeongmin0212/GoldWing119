"use client";

// 진로방해 차량 통보 — 업무 양식 + [통보 승인] / [무시] 두 버튼

import { Loader2 } from "lucide-react";
import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";
import type { ViolationRecord } from "@/types/drone";

const STATUS: Record<ViolationRecord["status"], { label: string; cls: string }> = {
  analyzing: { label: "에이전트 작성 중", cls: "text-drone" },
  pending: { label: "승인 대기", cls: "text-slow" },
  submitting: { label: "통보 중", cls: "text-drone" },
  submitted: { label: "지자체 통보 완료", cls: "text-ok" },
  dismissed: { label: "무시함", cls: "text-muted" },
  error: { label: "오류", cls: "text-fire" },
};

export default function ViolationAlertCard({ sim }: { sim: SimController }) {
  const { violations, selectedId } = sim;
  const v = violations.find((x) => x.id === selectedId) ?? violations[violations.length - 1];
  if (!v) return null;

  const st = STATUS[v.status];
  const busy = v.status === "analyzing" || v.status === "submitting";
  const d = v.draft;

  return (
    <div className="box">
      <div className="box-head">
        진로방해 차량 통보
        <span className={`tag ml-auto ${st.cls}`}>{st.label}</span>
      </div>
      {violations.length > 1 && (
        <div className="flex gap-1 border-b border-line px-3 py-2">
          {violations.map((x) => (
            <button
              key={x.id}
              onClick={() => sim.setSelectedId(x.id)}
              className={`border px-2 py-0.5 font-mono text-[12px] ${x.id === v.id ? "border-navy bg-navy-soft text-navy" : "border-line text-muted hover:bg-subtle"}`}
            >
              {x.plate} · {STATUS[x.status].label}
            </button>
          ))}
        </div>
      )}
      <div className="p-3">
        <table className="kv">
          <tbody>
            <tr>
              <th>차량번호</th>
              <td>
                <b className="font-mono text-[15px]">{v.plate}</b> <span className="text-muted">(가상) · {v.vehicleType}</span>
              </td>
            </tr>
            <tr>
              <th>위반 의심</th>
              <td className="font-semibold text-fire">{v.reason}</td>
            </tr>
            <tr>
              <th>위치</th>
              <td>{v.locationLabel}</td>
            </tr>
            <tr>
              <th>탐지</th>
              <td>
                {v.droneId} · T+{formatClock(v.detectedAtSim)} · 번호판 인식 신뢰도 {(v.confidence * 100).toFixed(0)}%
              </td>
            </tr>
            {d && (
              <>
                <tr>
                  <th>통보처</th>
                  <td>
                    {d.agency} <span className="text-muted">({d.jurisdictionShort}, {d.jurisdictionCode})</span>
                  </td>
                </tr>
                <tr>
                  <th>법적 근거</th>
                  <td>
                    {d.legalBasis.map((b) => (
                      <div key={b}>{b}</div>
                    ))}
                  </td>
                </tr>
                <tr>
                  <th>요청</th>
                  <td>{d.requestedAction}</td>
                </tr>
                <tr>
                  <th>증거</th>
                  <td>
                    {d.evidence.map((e) => (
                      <div key={e}>{e}</div>
                    ))}
                  </td>
                </tr>
                <tr>
                  <th>초안 본문</th>
                  <td className="leading-relaxed">{d.body}</td>
                </tr>
                {v.sources && v.sources.length > 0 && (
                  <tr>
                    <th>근거 문서</th>
                    <td className="text-muted">{v.sources.join(", ")}</td>
                  </tr>
                )}
              </>
            )}
            {v.status === "submitted" && v.receiptNo && (
              <tr>
                <th>접수번호</th>
                <td className="font-mono text-ok">{v.receiptNo}</td>
              </tr>
            )}
          </tbody>
        </table>

        {(v.status === "analyzing" || v.status === "pending" || v.status === "submitting") && (
          <div className="mt-3 flex gap-2">
            <button className="btn btn-fire flex-1" onClick={() => sim.approve(v.id)} disabled={v.status !== "pending"}>
              {busy && <Loader2 size={15} className="animate-spin" />}
              {v.status === "analyzing" ? "초안 작성 중" : v.status === "submitting" ? "통보 중" : "통보 승인"}
            </button>
            <button className="btn" onClick={() => sim.dismiss(v.id)} disabled={busy}>
              무시
            </button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">위반 확정·과태료·견인 결정은 관할 지자체 담당자가 합니다. 에이전트는 초안만 작성합니다.</p>
      </div>
    </div>
  );
}
