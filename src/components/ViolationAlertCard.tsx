"use client";

// 실시간 탐지 알림 카드 — [원클릭 신고 승인] / [무시] 두 버튼만

import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, FileText, Loader2, X } from "lucide-react";
import { formatClock } from "@/lib/geo";
import type { SimController } from "@/lib/useGoldenTimeSim";
import type { ViolationRecord } from "@/types/drone";

const STATUS: Record<ViolationRecord["status"], { label: string; cls: string }> = {
  analyzing: { label: "AI 분석 중", cls: "bg-ibm/20 text-ibm" },
  pending: { label: "신고 대기", cls: "bg-amber-500/20 text-amber-300" },
  submitting: { label: "접수 처리 중", cls: "bg-ibm/20 text-ibm" },
  submitted: { label: "지자체 통보 완료", cls: "bg-ok/20 text-ok" },
  dismissed: { label: "무시됨", cls: "bg-ink-700 text-ink-400" },
  error: { label: "오류", cls: "bg-alert/20 text-alert" },
};

function Thumb({ v }: { v: ViolationRecord }) {
  const truck = v.vehicleType.includes("트럭");
  return (
    <svg viewBox="0 0 80 64" className="h-16 w-20 shrink-0 rounded bg-[#1a1f27]" aria-hidden>
      <rect x="0" y="0" width="80" height="64" fill="#1a1f27" />
      <line x1="58" y1="0" x2="58" y2="64" stroke="#facc15" strokeOpacity="0.5" />
      <rect x="62" y="0" width="18" height="64" fill="#222b38" />
      <rect x="34" y="10" width="20" height="40" rx="4" fill={truck ? "#94a3b8" : v.vehicleType.includes("흰") ? "#f1f5f9" : "#52525b"} />
      <rect x="37" y="17" width="14" height="7" fill="#1e293b" />
      <rect x="29" y="5" width="30" height="50" fill="none" stroke="#ff3b3b" strokeWidth="2" />
      <rect x="4" y="50" width="52" height="11" fill="#7f1d1d" />
      <text x="7" y="58.5" fontSize="7.5" fill="#fff" fontFamily="monospace" fontWeight="bold">
        {v.plate}
      </text>
    </svg>
  );
}

export default function ViolationAlertCard({ sim }: { sim: SimController }) {
  const { violations, selectedId } = sim;
  const [showDraft, setShowDraft] = useState(false);
  const v = violations.find((x) => x.id === selectedId) ?? violations[violations.length - 1];

  if (!v) {
    return (
      <div className="rounded-lg border border-dashed border-ink-700 px-3 py-4 text-center text-[12px] text-ink-400">
        <AlertTriangle size={16} className="mx-auto mb-1 opacity-60" />
        진로 방해 차량이 탐지되면 여기에 알림 카드가 뜹니다.
      </div>
    );
  }

  const st = STATUS[v.status];
  const busy = v.status === "analyzing" || v.status === "submitting";

  return (
    <div className="slide-in rounded-lg border border-alert/50 bg-ink-850 p-3" key={v.id}>
      {violations.length > 1 && (
        <div className="mb-2 flex gap-1">
          {violations.map((x) => (
            <button
              key={x.id}
              onClick={() => sim.setSelectedId(x.id)}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                x.id === v.id ? "bg-alert/25 text-red-200" : "bg-ink-800 text-ink-400 hover:text-ink-100"
              }`}
            >
              {x.plate}
              {x.status === "submitted" ? " ✓" : x.status === "pending" ? " •" : ""}
            </button>
          ))}
        </div>
      )}

      <div className="flex gap-3">
        <Thumb v={v} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[17px] font-bold tracking-wide">{v.plate}</span>
            <span className="text-[10px] text-ink-400">(가상)</span>
            <span className={`ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>
          </div>
          <div className="mt-0.5 text-[12px] font-semibold text-red-300">{v.reason}</div>
          <div className="mt-0.5 truncate text-[11px] text-ink-300" title={v.locationLabel}>
            📍 {v.locationLabel}
          </div>
          <div className="text-[11px] text-ink-400">
            {v.vehicleType} · {v.droneId} · T+{formatClock(v.detectedAtSim)} · OCR {(v.confidence * 100).toFixed(0)}%
          </div>
        </div>
      </div>

      {v.draft && (
        <div className="mt-2 rounded bg-ink-900 text-[11.5px]">
          <button onClick={() => setShowDraft((s) => !s)} className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-ink-300 hover:text-ink-100">
            <FileText size={13} />
            통보 초안 — {v.draft.jurisdictionShort}({v.draft.jurisdictionCode}) · {v.draft.agency}
            <ChevronDown size={13} className={`ml-auto transition ${showDraft ? "rotate-180" : ""}`} />
          </button>
          {showDraft && (
            <div className="space-y-1 border-t border-ink-700 px-2 py-2 text-ink-300">
              <div className="font-semibold text-ink-100">{v.draft.title}</div>
              <div>좌표 {v.draft.coords} · {v.draft.detectedAt}</div>
              <div>
                근거:{" "}
                {v.draft.legalBasis.map((b) => (
                  <div key={b} className="pl-2 text-ink-400">
                    – {b}
                  </div>
                ))}
              </div>
              <div>요청: {v.draft.requestedAction}</div>
              <div className="rounded bg-ink-850 p-1.5 leading-relaxed text-ink-100">{v.draft.body}</div>
            </div>
          )}
        </div>
      )}

      {v.status === "submitted" && v.receiptNo && (
        <div className="mt-2 rounded bg-ok/10 px-2 py-1.5 text-[11.5px] text-ok">✓ 관할 지자체 통보·연계 접수 — {v.receiptNo}</div>
      )}

      {(v.status === "analyzing" || v.status === "pending" || v.status === "submitting") && (
        <div className="mt-2.5 flex gap-2">
          <button
            onClick={() => sim.approve(v.id)}
            disabled={v.status !== "pending"}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-alert py-2 text-[13px] font-bold text-white transition hover:brightness-110 disabled:cursor-wait disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            {v.status === "analyzing" ? "초안 작성 중…" : v.status === "submitting" ? "접수 중…" : "원클릭 신고 승인"}
          </button>
          <button
            onClick={() => sim.dismiss(v.id)}
            disabled={busy}
            className="flex items-center gap-1 rounded-md bg-ink-700 px-3 py-2 text-[12px] hover:bg-ink-600 disabled:opacity-50"
          >
            <X size={14} /> 무시
          </button>
        </div>
      )}
      <p className="mt-1.5 text-[10px] text-ink-400">위반 확정·과태료·견인 결정은 관할 지자체 담당자가 합니다. 에이전트는 초안만 작성합니다.</p>
    </div>
  );
}
