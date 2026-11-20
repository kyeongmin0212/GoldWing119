"use client";

// watsonx Orchestrate 질의 — 관제요원 질문과 에이전트 답만 모아 보여 줌

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import type { SimController } from "@/lib/useGoldenTimeSim";

const QUICK = ["소화전 5m 규정 근거는?", "이 차량 과태료 얼마야?", "긴급차량 진로 양보 의무 근거는?", "견인 지원 요청 근거는?"];

export default function QueryPanel({ sim }: { sim: SimController }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  const qa = sim.logs.filter((l) => (l.agent === "system" && l.text.startsWith("관제요원: ")) || (l.agent === "watsonx" && l.level === "success"));
  const waiting = sim.busyAgent === "watsonx";

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [qa.length, waiting]);

  const send = (m: string) => {
    const q = m.trim();
    if (!q) return;
    setText("");
    void sim.chat(q);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={ref} className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-[13px]">
        {qa.length === 0 && <p className="py-4 text-center text-muted">규정·절차를 물어보면 지식 문서를 근거로 답합니다.</p>}
        {qa.map((l) => {
          const mine = l.agent === "system";
          return (
            <div key={l.id} className={mine ? "text-right" : ""}>
              <div className={`inline-block max-w-[92%] border px-2.5 py-1.5 text-left ${mine ? "border-navy bg-navy-soft" : "border-line bg-white"}`}>
                {mine ? l.text.replace(/^관제요원: /, "") : l.text}
                {!mine && l.sources && l.sources.length > 0 && <div className="mt-1 text-[11px] text-muted">근거 문서: {l.sources.join(", ")}</div>}
              </div>
            </div>
          );
        })}
        {waiting && (
          <div className="text-muted">
            <Loader2 size={13} className="mr-1 inline animate-spin" />
            답변 작성 중
          </div>
        )}
      </div>
      <div className="border-t border-line p-2">
        <div className="mb-2 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button key={q} onClick={() => send(q)} className="border border-line bg-white px-2 py-0.5 text-[12px] text-muted hover:bg-subtle">
              {q}
            </button>
          ))}
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(text);
          }}
          className="flex gap-1.5"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="규정·절차 질문 입력"
            className="h-[34px] min-w-0 flex-1 border border-line-strong bg-white px-2.5 text-[13px] outline-none focus:border-navy"
          />
          <button type="submit" className="btn btn-primary" aria-label="보내기">
            <Send size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}
