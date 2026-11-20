"use client";

// 상황실 콘솔 → 소방차 태블릿 상태 공유 (BroadcastChannel: 같은 브라우저의 탭·창 사이 실시간 전달)
// 시연에서는 한 노트북에 두 창을 나란히 띄운다. 실서비스는 같은 메시지를 서버(WebSocket 등)로 중계하면 된다.

import { useEffect, useRef, useState } from "react";
import type { AgentName, ScenarioMode, SimStatus, ViolationRecord } from "@/types/drone";

export const SIM_CHANNEL = "gj-wing-sim-v1";

export interface SimSnapshot {
  /** 보낸 시각 (Date.now) — 받는 쪽이 경과 시간을 보간하는 데 씀 */
  sentAt: number;
  mode: ScenarioMode;
  status: SimStatus;
  simTime: number;
  speed: number;
  launch: boolean | null;
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

export function publishSnapshot(s: SimSnapshot): void {
  getChannel()?.postMessage(s);
}

/** 소방차 화면: 최신 스냅샷과 연결 여부 (2.5초 넘게 신호가 없으면 끊김) */
export function useSimSubscriber(): { snap: SimSnapshot | null; connected: boolean } {
  const [snap, setSnap] = useState<SimSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const lastRef = useRef(0);

  useEffect(() => {
    const ch = new BroadcastChannel(SIM_CHANNEL);
    ch.onmessage = (e: MessageEvent<SimSnapshot>) => {
      lastRef.current = Date.now();
      setSnap(e.data);
      setConnected(true);
    };
    const t = setInterval(() => setConnected(Date.now() - lastRef.current < 2500), 1000);
    return () => {
      clearInterval(t);
      ch.close();
    };
  }, []);

  return { snap, connected };
}
