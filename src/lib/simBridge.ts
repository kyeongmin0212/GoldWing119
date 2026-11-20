"use client";

// 상황실 콘솔 → 소방차 태블릿 상태 공유
// - 같은 브라우저의 탭·창: BroadcastChannel (즉시)
// - 다른 기기(노트북 ↔ 태블릿): 서버 중계 /api/sync (POST 로 올리고 Server-Sent Events 로 받음)

import { useEffect, useRef, useState } from "react";
import type { AgentName, RouteChoice, ScenarioMode, SimStatus, ViolationRecord } from "@/types/drone";

export const SIM_CHANNEL = "gj-wing-sim-v1";

export interface SimSnapshot {
  /** 보낸 시각 (Date.now) — 받는 쪽이 경과 시간을 보간하는 데 씀 */
  sentAt: number;
  mode: ScenarioMode;
  status: SimStatus;
  simTime: number;
  speed: number;
  launch: boolean | null;
  routeChoice: RouteChoice | null;
  focusDrone: string | null;
  violations: ViolationRecord[];
  recentLogs: { simTime: number; agent: AgentName; text: string }[];
  backend: "live" | "mock" | "unknown";
}

let channel: BroadcastChannel | null = null;
function getChannel(): BroadcastChannel | null {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") return null;
  if (!channel) channel = new BroadcastChannel(SIM_CHANNEL);
  return channel;
}

let inFlight = false;
let queued: SimSnapshot | null = null;
/** 서버로 올리기 — 이전 요청이 끝나지 않았으면 최신 것 하나만 이어서 보낸다 */
function postToServer(s: SimSnapshot): void {
  if (inFlight) {
    queued = s;
    return;
  }
  inFlight = true;
  fetch("/api/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(s) })
    .catch(() => {})
    .finally(() => {
      inFlight = false;
      const next = queued;
      queued = null;
      if (next) postToServer(next);
    });
}

export function publishSnapshot(s: SimSnapshot): void {
  getChannel()?.postMessage(s);
  if (typeof window !== "undefined") postToServer(s);
}

/** 소방차 화면: 최신 스냅샷과 연결 여부 (2.5초 넘게 신호가 없으면 끊김) */
export function useSimSubscriber(): { snap: SimSnapshot | null; connected: boolean } {
  const [snap, setSnap] = useState<SimSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const lastRef = useRef(0);

  useEffect(() => {
    let newest = 0;
    // 기기마다 시계가 다르므로 받은 시각(이 기기 시계)을 sentAt 으로 바꿔 보간에 쓴다. 두 경로로 같은 것이 오면 더 새 것만.
    const take = (s: SimSnapshot) => {
      if (s.sentAt < newest) return;
      newest = s.sentAt;
      lastRef.current = Date.now();
      setSnap({ ...s, sentAt: Date.now() });
      setConnected(true);
    };
    const ch = new BroadcastChannel(SIM_CHANNEL);
    ch.onmessage = (e: MessageEvent<SimSnapshot>) => take(e.data);
    const es = new EventSource("/api/sync");
    es.onmessage = (e) => {
      try {
        take(JSON.parse(e.data) as SimSnapshot);
      } catch {
        /* 무시 */
      }
    };
    const t = setInterval(() => setConnected(Date.now() - lastRef.current < 2500), 1000);
    return () => {
      clearInterval(t);
      ch.close();
      es.close();
    };
  }, []);

  return { snap, connected };
}
