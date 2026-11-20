"use client";

// 진로방해 차량 통보 초안 — 에이전트는 초안만 작성한다. 자동 통보·신고는 하지 않는다.
// 관제요원은 초안을 검토·복사해 두고, 실제 통보는 담당자가 관할 지자체 시스템에서 직접 한다.

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";
import type { ViolationRecord } from "@/types/drone";

const STATUS: Record<ViolationRecord["status"], { label: string; cls: string }> = {
  analyzing: { label: "초안 작성 중", cls: "text-drone" },
  pending: { label: "초안 검토 대기", cls: "text-slow" },
  reviewed: { label: "검토 완료 · 별도 통보 필요", cls: "text-ok" },
  dismissed: { label: "무시함", cls: "text-muted" },
  error: { label: "오류", cls: "text-fire" },
};

function draftText(v: ViolationRecord): string {
  const d = v.draft;
  if (!d) return "";
  return [
    `[${d.title}]`,
    `통보처: ${d.agency} (${d.jurisdictionShort}, ${d.jurisdictionCode})`,
    `차량번호: ${d.plate} (가상)`,
    `위치: ${d.location} (${d.coords})`,
    `탐지 시각: ${d.detectedAt}`,
    `위반 의심: ${d.violation}`,
    `법적 근거: ${d.legalBasis.join(" / ")}`,
    `요청: ${d.requestedAction}`,
    `증거: ${d.evidence.join(", ")}`,
    "",
    d.body,
  ].join("\n");
}

export default function ViolationAlertCard({ sim }: { sim: SimController }) {
  const { violations, selectedId } = sim;
  const [copied, setCopied] = useState<string | null>(null);
  const v = violations.find((x) => x.id === selectedId) ?? violations[violations.length - 1];
  if (!v) return null;

  const st = STATUS[v.status];
  const d = v.draft;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(draftText(v));
      setCopied(v.id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  return (
    <div className="box">
      <div className="box-head">
        진로방해 차량 통보 초안
        {v.fallback && <span className="tag ml-auto text-slow">IBM 호출 실패 · 예비 초안</span>}
        <span className={`tag ${v.fallback ? "" : "ml-auto "}${st.cls}`}>{st.label}</span>
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
          </tbody>
        </table>

        {(v.status === "analyzing" || v.status === "pending") && (
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={copy} disabled={v.status !== "pending"}>
              {copied === v.id ? "복사됨" : "초안 복사"}
            </button>
            <button className="btn btn-primary flex-1" onClick={() => sim.markReviewed(v.id)} disabled={v.status !== "pending"}>
              {v.status === "analyzing" && <Loader2 size={15} className="animate-spin" />}
              {v.status === "analyzing" ? "초안 작성 중" : "검토 완료"}
            </button>
            <button className="btn" onClick={() => sim.dismiss(v.id)} disabled={v.status === "analyzing"}>
              무시
            </button>
          </div>
        )}
        {v.status === "reviewed" && (
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={copy}>
              {copied === v.id ? "복사됨" : "초안 복사"}
            </button>
          </div>
        )}
        {(v.status === "error" || v.fallback) && (
          <div className="mt-2 flex items-center gap-2 border border-slow bg-slow-soft px-2 py-1.5 text-[12px] text-slow">
            {v.status === "error" ? "초안 작성 실패" : "IBM 호출이 실패해 코드 양식으로 만든 예비 초안입니다"}
            <button className="btn ml-auto" onClick={() => sim.regenerateDraft(v.id)}>
              초안 다시 생성
            </button>
          </div>
        )}
        <p className="mt-2 text-[11px] text-muted">
          에이전트는 통보 초안만 작성하며 자동으로 통보·신고하지 않습니다. 실제 통보는 담당자가 관할 지자체 시스템에서 직접 하고, 위반 확정·과태료·견인 결정은 지자체가 합니다.
        </p>
      </div>
    </div>
  );
}
