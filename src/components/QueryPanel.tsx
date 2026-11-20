"use client";

// watsonx Orchestrate 질의 — 관제요원 질문과 에이전트 답만 모아 보여 줌

import { useEffect, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import type { SimController } from "@/lib/useGoldenTimeSim";

const QUICK = ["소화전 5m 규정 근거는?", "이 차량 과태료 얼마야?", "긴급차량 진로 양보 의무 근거는?", "견인 지원 요청 근거는?"];

export default function QueryPanel({ sim }: { sim: SimController }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  // 질문과 그 답만 (통보 초안 완료 등 다른 IBM 응답은 표시 안 함). 답은 자기 질문 바로 아래에 붙인다
  const questions = sim.logs.filter((l) => l.qa === "q");
  const answers = new Map(sim.logs.filter((l) => l.qa === "a" && l.qaOf).map((l) => [l.qaOf!, l]));
  const firstOpen = questions.find((q) => !answers.has(q.id))?.id;

  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [questions.length, answers.size]);

  const send = (m: string) => {
    const q = m.trim();
    if (!q) return;
    setText("");
    void sim.chat(q);
  };

  return (
    <div className="flex h-full flex-col">
      <div ref={ref} className="scroll-thin min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-[13px]">
        {questions.length === 0 && <p className="py-4 text-center text-muted">규정·절차를 물어보면 지식 문서를 근거로 답합니다.</p>}
        {questions.map((q) => {
          const a = answers.get(q.id);
          return (
            <div key={q.id} className="space-y-2">
              <div className="text-right">
                <div className="inline-block max-w-[92%] border border-navy bg-navy-soft px-2.5 py-1.5 text-left">{q.text.replace(/^관제요원: /, "")}</div>
              </div>
              {a ? (
                <div>
                  <div className="inline-block max-w-[92%] border border-line bg-white px-2.5 py-1.5 text-left">
                    {a.text}
                    {a.sources && a.sources.length > 0 && <div className="mt-1 text-[11px] text-muted">근거 문서: {a.sources.join(", ")}</div>}
                  </div>
                </div>
              ) : (
                <div className="text-muted">
                  {q.id === firstOpen ? (
                    <>
                      <Loader2 size={13} className="mr-1 inline animate-spin" />
                      답변 작성 중
                    </>
                  ) : (
                    "앞 질문 답변 후 이어서 답합니다"
                  )}
                </div>
              )}
            </div>
          );
        })}
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
