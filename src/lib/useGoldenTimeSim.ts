"use client";

// 시뮬레이션 상태·이벤트·에이전트 호출을 묶은 대시보드 컨트롤러 훅
// 흐름: [출동 시나리오 시작] → 투입 판단(코드) → [드론 투입 승인] → 비행·정찰 → 탐지 → [신고 승인]

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOTSPOTS } from "@/data/congestionDb";
import { DRONE_BASES } from "@/data/droneBases";
import { CONTROL_ZONES, NO_FLY_ZONES } from "@/data/noFlyZones";
import { SCENARIOS } from "@/data/scenarioData";
import { decideDispatch } from "@/lib/dispatch";
import { formatClock, mapJurisdiction, pathEntersCircle } from "@/lib/geo";
import { buildSimPlan } from "@/lib/simulation";
import { publishSnapshot, type SimSnapshot } from "@/lib/simBridge";
import type {
  AgentLog,
  AgentName,
  AgentRequest,
  AgentResponse,
  ScenarioMode,
  SimStatus,
  ViolationRecord,
  ViolationSample,
} from "@/types/drone";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function baseDate(reportedAt: string): Date {
  const [h, m] = reportedAt.split(":").map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d;
}

async function callAgent(body: AgentRequest): Promise<AgentResponse> {
  const r = await fetch("/api/agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()) as AgentResponse;
}

export function useGoldenTimeSim() {
  const [mode, setMode] = useState<ScenarioMode>("urban");
  const scenario = SCENARIOS[mode];
  const decision = useMemo(() => decideDispatch(scenario, HOTSPOTS, DRONE_BASES), [scenario]);
  /** null = 아직 결정 전, true = 드론 투입 승인, false = 소방차만 */
  const [launch, setLaunch] = useState<boolean | null>(null);
  const plan = useMemo(() => buildSimPlan(scenario, NO_FLY_ZONES, decision, launch === true), [scenario, decision, launch]);

  const [status, setStatus] = useState<SimStatus>("idle");
  const [speed, setSpeed] = useState(30);
  const [simTime, setSimTime] = useState(0);
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backend, setBackend] = useState<"live" | "mock" | "unknown">("unknown");
  const [busyAgent, setBusyAgent] = useState<AgentName | null>(null);
  const backendRef = useRef<"live" | "mock" | "unknown">("unknown");
  const [focusDrone, setFocusDrone] = useState<string | null>(null);

  const threadRef = useRef<string | undefined>(undefined);
  const fallbackShown = useRef<string | null>(null);
  const firedRef = useRef<Set<string>>(new Set());
  const genRef = useRef(0);
  const logSeq = useRef(0);
  const simTimeRef = useRef(0);
  simTimeRef.current = simTime;
  backendRef.current = backend;

  const addLog = useCallback((agent: AgentName, text: string, level: AgentLog["level"] = "info", sources?: string[]) => {
    logSeq.current += 1;
    const entry: AgentLog = { id: `L${logSeq.current}`, agent, text, level, simTime: simTimeRef.current, sources };
    setLogs((l) => [...l.slice(-199), entry]);
  }, []);

  /** MOCK 전환 사유는 같은 내용이면 한 번만 표시 */
  const noteFallback = useCallback(
    (res: AgentResponse) => {
      if (res.mode !== "mock" || !res.fallbackReason || fallbackShown.current === res.fallbackReason) return;
      fallbackShown.current = res.fallbackReason;
      addLog("system", res.fallbackReason, "warn");
    },
    [addLog],
  );

  const patchViolation = useCallback((id: string, patch: Partial<ViolationRecord>) => {
    setViolations((vs) => vs.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  }, []);

  useEffect(() => {
    fetch("/api/agent")
      .then((r) => r.json())
      .then((d: { mode: "live" | "mock" }) => setBackend(d.mode))
      .catch(() => setBackend("mock"));
  }, []);

  // 시뮬레이션 루프
  useEffect(() => {
    if (status !== "running") return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setSimTime((t) => Math.min(t + dt * speed, plan.endSec));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, speed, plan.endSec]);

  const playSteps = useCallback(
    async (res: AgentResponse, gen: number) => {
      for (const s of res.steps) {
        setBusyAgent(s.agent);
        await sleep(s.delayMs);
        if (gen !== genRef.current) return false;
        addLog(s.agent, s.text, "progress");
      }
      setBusyAgent(null);
      return true;
    },
    [addLog],
  );

  const detect = useCallback(
    async (v: ViolationSample, droneId: string, atSec: number) => {
      const gen = genRef.current;
      const iso = new Date(baseDate(scenario.incident.reportedAt).getTime() + atSec * 1000).toISOString();
      const rec: ViolationRecord = { ...v, droneId, detectedAtSim: atSec, detectedAtIso: iso, status: "analyzing" };
      setViolations((vs) => [...vs, rec]);
      setSelectedId(v.id);
      setFocusDrone(droneId);
      addLog("vision", `[${droneId}] 진로 방해 차량 탐지 — ${v.plate}(가상) · ${v.reason} · 신뢰도 ${(v.confidence * 100).toFixed(0)}%`, "warn");
      addLog("vision", `번호판 OCR "${v.plate}" → 탐지 JSON을 IBM 에이전트로 전달`, "info");
      try {
        setBusyAgent("report");
        if (backendRef.current === "live")
          addLog("watsonx", `[${v.plate}] Orchestrate 감독 에이전트 호출 — 비전 검증 → 행정 신고 에이전트 순서로 처리 중 (보통 10~25초)`, "progress");
        const res = await callAgent({ type: "violation_detected", violation: { ...v, detectedAtIso: iso }, threadId: threadRef.current });
        if (gen !== genRef.current) return;
        setBackend(res.mode);
        if (res.threadId) threadRef.current = res.threadId;
        noteFallback(res);
        if (!(await playSteps(res, gen))) return;
        patchViolation(v.id, { status: "pending", draft: res.draft, agentMessage: res.message, sources: res.sources });
        addLog(res.mode === "live" ? "watsonx" : "report", res.message, "success", res.sources);
      } catch (e) {
        setBusyAgent(null);
        patchViolation(v.id, { status: "error" });
        addLog("system", `에이전트 호출 오류: ${e instanceof Error ? e.message : e}`, "warn");
      }
    },
    [scenario.incident.reportedAt, addLog, playSteps, patchViolation, noteFallback],
  );

  // 이벤트 타임라인 (투입 결정 후에 구성)
  const events = useMemo(() => {
    const ev: { id: string; at: number; run: () => void }[] = [];
    if (launch === null) return ev;
    for (const d of plan.drones) {
      const id = d.assignment.droneId;
      const f = d.flight;
      ev.push({
        id: `plan-${id}`,
        at: 0,
        run: () => {
          if (f.blockedBy.length) {
            addLog("route", `[${id}] 비행금지구역 DB 대조: 직선 경로가 '${f.blockedBy.join(", ")}' 침범 → 원천 배제`, "warn");
            addLog(
              "route",
              `[${id}] 권장 우회 경로 ${f.plannedKm.toFixed(1)}km 산출 (+${(f.plannedKm - f.directKm).toFixed(1)}km, 꺾임점 ${f.path.length - 2}개, 안전거리 350m) — 원격 조종자 화면에 표시`,
              "success",
            );
          } else {
            addLog("route", `[${id}] 비행금지구역 침범 없음 — 직선 ${f.directKm.toFixed(1)}km 권장 경로를 원격 조종자에게 안내`, "success");
          }
          const ctr = CONTROL_ZONES.find((z) => pathEntersCircle(f.path, z.center, z.radiusKm));
          if (ctr) {
            addLog("route", `[${id}] '${ctr.name}' 통과 — 금지 아님, 승인 대상 (긴급비행 특례도 승인을 면제하지 않음)`, "warn");
            addLog("route", `[${id}] 지자체 소방드론 화재 대응 긴급 비행(항공안전법 제131조의2②) · 관제기관 사전 협의 건 → 사전 통보 시 승인 간주 (제127조④·시행규칙 제308조⑧), 통보 문안 자동 생성`, "progress");
            addLog("route", `[${id}] 비행 후 승인신청서 제출 예약 (제308조⑨) · 목적: 교통장애 모니터링(제313조의2①8호) — 출동 연계 정찰에 한정`, "info");
          }
          addLog(
            "pathfinder",
            d.launchSec > 0
              ? `[${id}] 권장 이륙 시각 T+${formatClock(d.launchSec)} 안내 — 소방차보다 ${formatClock(d.leadSec)} 먼저 도착 (체공 배터리 절약)`
              : `[${id}] 즉시 이륙 권장 — 예상 선행 ${formatClock(d.leadSec)}`,
            "info",
          );
        },
      });
      if (d.launchSec > 0)
        ev.push({ id: `launch-${id}`, at: d.launchSec, run: () => addLog("pathfinder", `[${id}] 원격 조종자 이륙 준비 — ${d.assignment.base.name}`, "info") });
      ev.push({
        id: `arrive-${id}`,
        at: d.scanStartSec,
        run: () => {
          setFocusDrone(id);
          addLog("pathfinder", `[${id}] 원격 조종자가 '${d.assignment.cluster.label}' 도착 — 소방차보다 ${formatClock(d.leadSec)} 선행`, "success");
          if (d.assignment.role === "guide+detect") {
            addLog("vision", `[${id}] 비전 탐지 활성화 — 소방차 진입로 주정차 차량 스캔`, "info");
            addLog("vision", `[${id}] 개인정보 보호: 촬영 고지 송출, 얼굴 자동 블러, 번호판 OCR은 신고 전까지 최소 보관 (개인정보 보호법 제25조의2)`, "info");
          }
        },
      });
      ev.push({
        id: `broadcast-${id}`,
        at: d.broadcastSec,
        run: () => addLog("pathfinder", `[${id}] 소방차 도착 3분 전 — LED·음성 송출: "긴급차량 접근 중, 우측으로 양보 바랍니다"`, "info"),
      });
    }
    scenario.truckRoute.forEach((s, k) => {
      const inCluster = decision.clusters.some((c) => k >= c.firstSeg && k <= c.lastSeg);
      if (!inCluster) return;
      ev.push({ id: `truck-${k}`, at: plan.truck.times[k], run: () => addLog("system", `소방차 '${s.label}' 진입 (예상 ${s.speedKmh}km/h)`, "info") });
    });
    plan.detections.forEach((d) => {
      const v = scenario.violations.find((x) => x.id === d.violationId)!;
      ev.push({ id: `detect-${v.id}`, at: d.atSec, run: () => void detect(v, d.droneId, d.atSec) });
    });
    ev.push({
      id: "truck-arrive",
      at: plan.truck.totalSec,
      run: () => {
        addLog("system", `소방차 현장 도착 (T+${formatClock(plan.truck.totalSec)}) — 시나리오 종료`, "success");
        setStatus("finished");
      },
    });
    return ev;
  }, [launch, plan, scenario, decision.clusters, addLog, detect]);

  useEffect(() => {
    if (status !== "running") return;
    for (const e of events) {
      if (e.at <= simTime && !firedRef.current.has(e.id)) {
        firedRef.current.add(e.id);
        e.run();
      }
    }
  }, [simTime, status, events]);

  const reset = useCallback(() => {
    genRef.current += 1;
    firedRef.current = new Set();
    threadRef.current = undefined;
    fallbackShown.current = null;
    setStatus("idle");
    setLaunch(null);
    setSimTime(0);
    setViolations([]);
    setLogs([]);
    setSelectedId(null);
    setBusyAgent(null);
    setFocusDrone(null);
  }, []);

  /** [출동 시나리오 시작] → 투입 판단 카드 */
  const begin = useCallback(() => {
    addLog("system", `119 신고 접수 ${scenario.incident.reportedAt} — ${scenario.incident.name} · ${scenario.incident.type}`, "warn");
    addLog("system", `${scenario.station.name} 소방차 출동 지령`, "info");
    const from = mapJurisdiction(scenario.station.position);
    const to = mapJurisdiction(scenario.incident.position);
    if (from.code.slice(0, 2) !== to.code.slice(0, 2))
      addLog("route", `옛 시도 경계 넘는 출동: ${from.short}(${from.code}, ${from.former}) → ${to.short}(${to.code}, ${to.former}) — 단속 통보는 현장 관할 ${to.agency}`, "warn");
    addLog("route", `출동 경로 분석: 평시 ${formatClock(decision.normalSec)} → 예상 ${formatClock(decision.expectedSec)} (지연 ${formatClock(Math.max(0, decision.delaySec))})`, "info");
    const active = decision.matches.filter((m) => m.active);
    addLog("route", active.length ? `혼잡 DB 대조: 경로상 ${active.map((m) => m.hotspot.name).join(", ")}` : "혼잡 DB 대조: 경로상 활성 혼잡 구역 없음", active.length ? "warn" : "info");
    addLog(
      "route",
      decision.recommend
        ? `드론 투입 권고 ${decision.recommend}대 — 관제요원 승인 대기`
        : "드론 투입 불필요 판단 — 관제요원 확인 대기",
      "progress",
    );
    setStatus("awaiting");
  }, [scenario, decision, addLog]);

  const start = useCallback(() => {
    if (status === "finished") {
      reset();
      setTimeout(begin, 0);
      return;
    }
    if (status === "idle") return begin();
    if (status === "paused") setStatus("running");
  }, [status, reset, begin]);

  /** 관제요원 결정: true = 드론 투입 승인, false = 소방차만 출동 */
  const confirmDispatch = useCallback(
    (withDrones: boolean) => {
      if (status !== "awaiting") return;
      const n = withDrones ? decision.recommend : 0;
      addLog(
        "system",
        n ? `관제요원 [드론 투입 승인] — ${decision.assignments.map((a) => `${a.droneId}(${a.base.name})`).join(", ")}` : "관제요원 확인 — 소방차만 출동",
        "info",
      );
      setLaunch(withDrones && decision.recommend > 0);
      setStatus("running");
    },
    [status, decision, addLog],
  );

  const pause = useCallback(() => setStatus((s) => (s === "running" ? "paused" : s)), []);

  const changeMode = useCallback(
    (m: ScenarioMode) => {
      reset();
      setMode(m);
    },
    [reset],
  );

  const approve = useCallback(
    async (id: string) => {
      const v = violations.find((x) => x.id === id);
      if (!v || !v.draft || v.status !== "pending") return;
      const gen = genRef.current;
      patchViolation(id, { status: "submitting" });
      addLog("system", `관제요원 [신고 승인] — ${v.plate}`, "info");
      try {
        setBusyAgent("report");
        const res = await callAgent({ type: "report_approved", violation: v, draft: v.draft, threadId: threadRef.current });
        if (gen !== genRef.current) return;
        setBackend(res.mode);
        noteFallback(res);
        if (!(await playSteps(res, gen))) return;
        patchViolation(id, { status: "submitted", receiptNo: res.receiptNo, agentMessage: res.message });
        addLog(res.mode === "live" ? "watsonx" : "report", res.message, "success");
      } catch (e) {
        setBusyAgent(null);
        patchViolation(id, { status: "pending" });
        addLog("system", `승인 처리 오류: ${e instanceof Error ? e.message : e}`, "warn");
      }
    },
    [violations, patchViolation, addLog, playSteps, noteFallback],
  );

  const dismiss = useCallback(
    (id: string) => {
      const v = violations.find((x) => x.id === id);
      if (!v) return;
      patchViolation(id, { status: "dismissed" });
      addLog("system", `관제요원 [무시] — ${v.plate} (신고하지 않음, 기록만 보존)`, "info");
    },
    [violations, patchViolation, addLog],
  );

  const chat = useCallback(
    async (message: string) => {
      const gen = genRef.current;
      addLog("system", `관제요원: ${message}`, "info");
      const context = [
        `시나리오: ${scenario.title}`,
        `경과: T+${formatClock(simTimeRef.current)}`,
        `드론 투입: ${launch ? plan.drones.map((d) => d.assignment.droneId).join(", ") : "없음"}`,
        `탐지 차량: ${violations.map((v) => `${v.plate}(${v.status}, ${mapJurisdiction(v.position).short})`).join(", ") || "없음"}`,
      ].join("\n");
      try {
        setBusyAgent("watsonx");
        const res = await callAgent({ type: "chat", message, context, threadId: threadRef.current });
        if (gen !== genRef.current) return;
        setBackend(res.mode);
        if (res.threadId) threadRef.current = res.threadId;
        setBusyAgent(null);
        addLog("watsonx", res.message, "success", res.sources);
      } catch (e) {
        setBusyAgent(null);
        addLog("system", `질의 오류: ${e instanceof Error ? e.message : e}`, "warn");
      }
    },
    [scenario.title, launch, plan.drones, violations, addLog],
  );

  // 승인으로 배정된 드론 수 (이륙 예약 포함) — 헤더 "대기 16 / 출동 2"
  const activeDrones = launch ? plan.drones.length : 0;

  // 소방차 태블릿으로 상태 공유: 상태가 바뀌면 즉시, 시간은 0.25초마다, 정지 중에도 1초마다 신호
  const buildSnapshot = (): SimSnapshot => ({
    sentAt: Date.now(),
    mode,
    status,
    simTime: simTimeRef.current,
    speed,
    launch,
    focusDrone,
    violations,
    recentLogs: logs.slice(-8).map((l) => ({ simTime: l.simTime, agent: l.agent, text: l.text })),
    backend,
  });
  const snapRef = useRef(buildSnapshot);
  snapRef.current = buildSnapshot;
  const lastPubRef = useRef(0);
  const pub = useCallback(() => {
    publishSnapshot(snapRef.current());
    lastPubRef.current = Date.now();
  }, []);
  useEffect(() => {
    pub();
  }, [pub, mode, status, speed, launch, focusDrone, violations, logs, backend]);
  useEffect(() => {
    if (Date.now() - lastPubRef.current > 250) pub();
  }, [pub, simTime]);
  useEffect(() => {
    const t = setInterval(pub, 1000);
    return () => clearInterval(t);
  }, [pub]);

  return {
    mode,
    scenario,
    decision,
    launch,
    plan,
    zones: NO_FLY_ZONES,
    controlZones: CONTROL_ZONES,
    hotspots: HOTSPOTS,
    bases: DRONE_BASES,
    status,
    speed,
    setSpeed,
    simTime,
    violations,
    logs,
    selectedId,
    setSelectedId,
    backend,
    busyAgent,
    activeDrones,
    focusDrone,
    setFocusDrone,
    start,
    pause,
    reset,
    changeMode,
    confirmDispatch,
    approve,
    dismiss,
    chat,
  };
}

export type SimController = ReturnType<typeof useGoldenTimeSim>;
