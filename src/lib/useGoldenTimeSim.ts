"use client";

// 시뮬레이션 상태·이벤트·에이전트 호출을 묶은 대시보드 컨트롤러 훅
// 흐름: [출동 시나리오 시작] → 투입 판단(코드) → [드론 투입 승인] → 소방차 경로를 따라 선행 정찰
//       → (전방 차단 발견 시) [우회로 안내 승인 / 기존 경로 유지] → 탐지 → 통보 초안 작성 (실제 통보는 담당자가 직접)

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HOTSPOTS } from "@/data/congestionDb";
import { DRONE_BASES } from "@/data/droneBases";
import { SCENARIOS } from "@/data/scenarioData";
import { decideDispatch } from "@/lib/dispatch";
import { formatClock, mapJurisdiction } from "@/lib/geo";
import { buildReportDraft } from "@/lib/report";
import { buildSimPlan } from "@/lib/simulation";
import { publishSnapshot, type SimSnapshot } from "@/lib/simBridge";
import type {
  AgentBackend,
  AgentHealth,
  AgentLog,
  AgentName,
  AgentRequest,
  AgentResponse,
  RouteChoice,
  ScenarioMode,
  SimStatus,
  ViolationRecord,
  ViolationSample,
} from "@/types/drone";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 에이전트 응답으로 연결 표시 정하기: LIVE 응답 → 연결됨, 설정은 있는데 실패해 대체 → 연결 끊김, 설정 없음 → 시뮬레이션 */
const backendOf = (res: AgentResponse): AgentBackend => (res.mode === "live" ? "live" : res.offline ? "offline" : "mock");

/** 연결 확인 주기 — 시연 중 인터넷이 끊기거나 키가 만료되면 이 간격 안에 표시가 바뀐다 */
const HEALTH_INTERVAL_MS = 30_000;

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
  const [mode, setMode] = useState<ScenarioMode>("regional");
  const scenario = SCENARIOS[mode];
  const decision = useMemo(() => decideDispatch(scenario, HOTSPOTS, DRONE_BASES), [scenario]);
  /** null = 아직 결정 전, true = 드론 투입 승인, false = 소방차만 */
  const [launch, setLaunch] = useState<boolean | null>(null);
  /** 전방 차단 발견 시 관제요원의 경로 판단 (null = 판단 전) */
  const [routeChoice, setRouteChoice] = useState<RouteChoice | null>(null);
  const plan = useMemo(() => buildSimPlan(scenario, decision, launch !== false, routeChoice), [scenario, decision, launch, routeChoice]);

  const [status, setStatus] = useState<SimStatus>("idle");
  // 기본 재생 배속 ×5 (빠르면 드론 영상이 너무 빠르게 흐름 — 영상·지도·소방차가 같이 느려짐)
  const [speed, setSpeed] = useState(5);
  const [simTime, setSimTime] = useState(0);
  const [violations, setViolations] = useState<ViolationRecord[]>([]);
  const violationsRef = useRef<ViolationRecord[]>([]);
  violationsRef.current = violations;
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backend, setBackend] = useState<AgentBackend>("unknown");
  /** 마지막 연결 확인 시각·실패 사유 (표시 위에 마우스를 올리면 보임) */
  const [backendInfo, setBackendInfo] = useState<{ checkedAt?: string; reason?: string }>({});
  const [busyAgent, setBusyAgent] = useState<AgentName | null>(null);
  const backendRef = useRef<AgentBackend>("unknown");
  const [focusDrone, setFocusDrone] = useState<string | null>(null);

  // 질의 탭 전용 IBM 대화(스레드). 통보 초안은 차량마다 새 대화로 요청해 질의 답에 초안이 섞이지 않게 한다
  const threadRef = useRef<string | undefined>(undefined);
  const fallbackShown = useRef<string | null>(null);
  const firedRef = useRef<Set<string>>(new Set());
  const genRef = useRef(0);
  const logSeq = useRef(0);
  const simTimeRef = useRef(0);
  simTimeRef.current = simTime;
  backendRef.current = backend;

  const addLog = useCallback((agent: AgentName, text: string, level: AgentLog["level"] = "info", sources?: string[], qa?: AgentLog["qa"], qaOf?: string) => {
    logSeq.current += 1;
    const entry: AgentLog = { id: `L${logSeq.current}`, agent, text, level, simTime: simTimeRef.current, sources, qa, qaOf };
    setLogs((l) => [...l.slice(-199), entry]);
    return entry.id;
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

  /** 에이전트 응답을 받을 때마다 연결 표시도 갱신 */
  const noteBackend = useCallback((res: AgentResponse) => {
    setBackend(backendOf(res));
    setBackendInfo({ checkedAt: new Date().toISOString(), reason: res.offline ? res.fallbackReason : undefined });
  }, []);

  // 연결 확인: 처음 한 번 + 30초마다 서버가 IBM 에 실제로 요청해 본 결과로 표시
  useEffect(() => {
    let alive = true;
    // 대시보드 서버 자체에 닿지 못한 경우(페이지 로딩·서버 재시작 중 등)는 한 번으로 판단하지 않고 3초 뒤 다시 확인,
    // 두 번 연속 실패할 때만 끊김 표시 (IBM 쪽 실패는 서버가 이미 실제로 확인한 결과라 바로 표시)
    let misses = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const check = (): Promise<void> =>
      fetch("/api/agent", { cache: "no-store" })
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return r.json() as Promise<AgentHealth>;
        })
        .then((d) => {
          if (!alive) return;
          misses = 0;
          setBackend(d.mode);
          setBackendInfo({ checkedAt: d.checkedAt, reason: d.reason });
        })
        .catch((e) => {
          if (!alive) return;
          misses += 1;
          if (misses < 2) {
            retry = setTimeout(check, 3000);
            return;
          }
          setBackend("offline");
          setBackendInfo({ checkedAt: new Date().toISOString(), reason: `대시보드 서버 응답 없음 (${e instanceof Error ? e.message : e})` });
        });
    check();
    const t = setInterval(check, HEALTH_INTERVAL_MS);
    return () => {
      alive = false;
      clearInterval(t);
      if (retry) clearTimeout(retry);
    };
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

  // 통보 초안 요청 — 한 번에 하나씩(동시 호출 충돌 방지), 실패하면 한 번 더 시도, 그래도 실패하면 예비 초안(코드 양식)
  const draftQueue = useRef<Promise<void>>(Promise.resolve());
  const requestDraft = useCallback(
    (v: ViolationSample, iso: string) => {
      const gen = genRef.current;
      const job = async () => {
        if (gen !== genRef.current) return;
        patchViolation(v.id, { status: "analyzing", fallback: false });
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            setBusyAgent("report");
            if (backendRef.current === "live")
              addLog("watsonx", `[${v.plate}] Orchestrate 감독 에이전트 호출${attempt > 1 ? " (다시 시도)" : ""} — 비전 검증 → 행정 신고 에이전트 순서로 처리 중 (보통 10~25초)`, "progress");
            const res = await callAgent({ type: "violation_detected", violation: { ...v, detectedAtIso: iso } });
            if (gen !== genRef.current) return;
            noteBackend(res);
            noteFallback(res);
            if (!(await playSteps(res, gen))) return;
            patchViolation(v.id, { status: "pending", draft: res.draft, agentMessage: res.message, sources: res.sources, fallback: false });
            addLog(res.mode === "live" ? "watsonx" : "report", res.message, "success", res.sources);
            return;
          } catch (e) {
            setBusyAgent(null);
            if (gen !== genRef.current) return;
            addLog("system", `[${v.plate}] 에이전트 호출 오류: ${e instanceof Error ? e.message : e}${attempt === 1 ? " — 2초 뒤 다시 시도" : ""}`, "warn");
            if (attempt === 1) await sleep(2000);
          }
        }
        // 두 번 다 실패 → 코드가 만든 예비 초안 (관할·법적 근거·양식은 원래도 코드가 결정)
        const draft = buildReportDraft({ ...v, detectedAtIso: iso });
        patchViolation(v.id, { status: "pending", draft, fallback: true, sources: ["지자체 통보 양식과 작성 요령"], agentMessage: "IBM 호출 실패 · 예비 초안" });
        addLog("report", `[${v.plate}] IBM 호출 실패 → 예비 초안 표시 (코드 양식). [초안 다시 생성]으로 다시 요청할 수 있음`, "warn");
      };
      const next = draftQueue.current.then(job, job);
      draftQueue.current = next.catch(() => {});
      return next;
    },
    [addLog, playSteps, patchViolation, noteFallback, noteBackend],
  );

  const detect = useCallback(
    async (v: ViolationSample, droneId: string, atSec: number) => {
      const iso = new Date(baseDate(scenario.incident.reportedAt).getTime() + atSec * 1000).toISOString();
      const rec: ViolationRecord = { ...v, droneId, detectedAtSim: atSec, detectedAtIso: iso, status: "analyzing" };
      setViolations((vs) => [...vs, rec]);
      setSelectedId(v.id);
      setFocusDrone(droneId);
      addLog("vision", `[${droneId}] 진로 방해 차량 탐지 — ${v.plate}(가상) · ${v.reason} · 신뢰도 ${(v.confidence * 100).toFixed(0)}%`, "warn");
      addLog("vision", `번호판 OCR "${v.plate}" → 탐지 JSON을 IBM 에이전트로 전달`, "info");
      await requestDraft(v, iso);
    },
    [scenario.incident.reportedAt, addLog, requestDraft],
  );

  /** [초안 다시 생성] — 오류·예비 초안 카드에서 다시 요청 */
  const regenerateDraft = useCallback(
    (id: string) => {
      const v = violationsRef.current.find((x) => x.id === id);
      if (!v || v.status === "analyzing") return;
      addLog("system", `관제요원 [초안 다시 생성] — ${v.plate}`, "info");
      void requestDraft(v, v.detectedAtIso);
    },
    [addLog, requestDraft],
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
          addLog(
            "route",
            `[${id}] 권장 경로: ${d.assignment.base.name} → 소방차 경로 합류(${f.directKm.toFixed(1)}km) → 소방차가 갈 도로를 따라 '${d.assignment.cluster.label}' 정찰 — 원격 조종자 화면에 표시`,
            "success",
          );
          addLog(
            "pathfinder",
            d.launchSec > 0
              ? `[${id}] 권장 이륙 시각 T+${formatClock(d.launchSec)} 안내 — 소방차보다 ${formatClock(d.leadSec)} 먼저 도착 (체공 배터리 절약)`
              : `[${id}] 소방차와 동시 출발 — 소방차가 갈 도로를 따라 앞서 비행, 예상 선행 ${formatClock(d.leadSec)}`,
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

    }
    plan.route.segs.forEach((s, k) => {
      const inCluster = decision.clusters.some((c) => k >= c.firstSeg && k <= c.lastSeg);
      if (!inCluster) return;
      ev.push({ id: `truck-${k}`, at: plan.truck.times[k], run: () => addLog("system", `소방차 '${s.label}' 진입 (예상 ${s.speedKmh}km/h)`, "info") });
    });
    const blk = plan.blockage;
    const scoutSim = blk ? plan.drones.find((d) => d.assignment.droneId === blk.droneId) : undefined;
    if (blk && scoutSim?.aheadSec)
      ev.push({
        id: `ahead-${blk.droneId}`,
        at: scoutSim.aheadSec,
        run: () => addLog("pathfinder", `[${blk.droneId}] 정찰 구간 통과 — 원격 조종자가 소방차 경로를 따라 전방 선행 정찰 계속`, "info"),
      });
    if (blk && routeChoice === null)
      ev.push({
        id: "blockage",
        at: blk.atSec,
        run: () => {
          setFocusDrone(blk.droneId);
          addLog("vision", blk.kind === "parking" ? `[${blk.droneId}] 현장 진입로 불법주차 확인 — ${blk.label} · 차량별 통보 초안은 따로 작성` : `[${blk.droneId}] 전방 도로 막힘 확인 — ${blk.label}`, "warn");
          addLog(
            "route",
            `우회로 비교(규칙 계산): 기존 경로 유지 시 현장 T+${formatClock(blk.stayArrivalSec)} / 우회(${blk.summary}) 시 T+${formatClock(blk.detourArrivalSec)} → ${formatClock(blk.savedSec)} 단축. 소방차 갈림길 도착 T+${formatClock(blk.decideBySec)} 전까지 판단 필요`,
            "progress",
          );
          setStatus("rerouting");
        },
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
  }, [launch, plan, scenario, decision.clusters, routeChoice, addLog, detect]);

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
    setRouteChoice(null);
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

  /** 관제요원 경로 판단: 우회로 안내 승인 / 기존 경로 유지 */
  const chooseRoute = useCallback(
    (choice: RouteChoice) => {
      const blk = plan.blockage;
      if (status !== "rerouting" || !blk) return;
      if (choice === "detour") {
        addLog("system", `관제요원 [우회로 안내 승인] — 소방차 화면에 안내: ${blk.summary}`, "info");
        addLog("route", `소방차 경로 변경 — 현장 도착 예정 T+${formatClock(blk.detourArrivalSec)} (기존 유지 대비 ${formatClock(blk.savedSec)} 단축)`, "success");
        addLog("pathfinder", `[${blk.droneId}] 원격 조종자가 우회로를 앞서 비행하며 통행 가능 여부 확인`, "info");
      } else {
        addLog("system", blk.kind === "parking" ? "관제요원 [기존 경로 유지] — 불법주차 차량 사이로 서행 통과 (필요하면 견인 지원 요청: 소방기본법 제25조제4항)" : "관제요원 [기존 경로 유지] — 막힌 구간 서행 통과", "info");
        addLog("route", `현장 도착 예정 T+${formatClock(blk.stayArrivalSec)}`, "info");
      }
      setRouteChoice(choice);
      setStatus("running");
    },
    [status, plan.blockage, addLog],
  );

  const pause = useCallback(() => setStatus((s) => (s === "running" ? "paused" : s)), []);

  const changeMode = useCallback(
    (m: ScenarioMode) => {
      reset();
      setMode(m);
    },
    [reset],
  );

  /** 통보 초안 검토 완료 — 자동 통보하지 않는다. 실제 통보는 담당자가 관할 지자체 시스템에서 직접 */
  const markReviewed = useCallback(
    (id: string) => {
      const v = violations.find((x) => x.id === id);
      if (!v || !v.draft || v.status !== "pending") return;
      patchViolation(id, { status: "reviewed" });
      addLog("system", `관제요원 [검토 완료] — ${v.plate} 통보 초안 보관. 실제 통보는 담당자가 ${v.draft.agency}에 직접 진행`, "info");
    },
    [violations, patchViolation, addLog],
  );

  const dismiss = useCallback(
    (id: string) => {
      const v = violations.find((x) => x.id === id);
      if (!v) return;
      patchViolation(id, { status: "dismissed" });
      addLog("system", `관제요원 [무시] — ${v.plate} (통보 초안 사용 안 함, 기록만 보존)`, "info");
    },
    [violations, patchViolation, addLog],
  );

  // 질의는 한 번에 하나씩: 앞 질문의 답이 온 뒤 다음 질문을 보내 답 순서가 질문 순서와 같게 한다
  const chatQueue = useRef<Promise<void>>(Promise.resolve());
  const chat = useCallback(
    (message: string) => {
      const gen = genRef.current;
      const qid = addLog("system", `관제요원: ${message}`, "info", undefined, "q");
      const job = async () => {
        if (gen !== genRef.current) return;
        // 차량 번호·초안 상태는 보내지 않는다 — 보내면 감독 에이전트가 검증·초안 에이전트를 불러 그 결과를 답에 섞음
        const context = [
          `시나리오: ${scenario.title}`,
          `경과: T+${formatClock(simTimeRef.current)}`,
          `드론 투입: ${launch ? plan.drones.map((d) => d.assignment.droneId).join(", ") : "없음"}`,
          `탐지 차량: ${violationsRef.current.length}대 (검증·통보 초안은 대시보드가 따로 처리 중)`,
          "[답변 규칙] 관제요원의 질문에만 답할 것. 차량 검증·통보 초안 작성은 이 질의에서 하지 말고, 다른 에이전트를 호출해 초안·검증 결과를 답에 넣지 말 것.",
          "[이 시제품의 절차 — 질문이 시연·시제품 사용법이면 이대로 답할 것] 에이전트는 지자체 통보 초안만 작성한다. 관제요원이 초안을 검토·보관([검토 완료])하고, 실제 통보는 담당자가 관할 지자체 시스템에서 별도로 진행한다. 시스템은 자동으로 통보·신고하지 않으며 위반 확정·과태료·견인 결정은 지자체가 한다. 드론 투입과 우회로 안내는 관제요원이 승인하고, 드론은 원격 조종자가 조종한다.",
        ].join("\n");
        try {
          const res = await callAgent({ type: "chat", message, context, threadId: threadRef.current });
          if (gen !== genRef.current) return;
          noteBackend(res);
          noteFallback(res);
          if (res.threadId) threadRef.current = res.threadId;
          addLog("watsonx", res.message, "success", res.sources, "a", qid);
        } catch (e) {
          if (gen !== genRef.current) return;
          addLog("system", `질의 오류: ${e instanceof Error ? e.message : e}`, "warn", undefined, "a", qid);
        }
      };
      const next = chatQueue.current.then(job, job);
      chatQueue.current = next.catch(() => {});
      return next;
    },
    [scenario.title, launch, plan.drones, addLog, noteBackend, noteFallback],
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
    routeChoice,
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
  }, [pub, mode, status, speed, launch, routeChoice, focusDrone, violations, logs, backend]);
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
    routeChoice,
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
    backendInfo,
    busyAgent,
    activeDrones,
    focusDrone,
    setFocusDrone,
    start,
    pause,
    reset,
    changeMode,
    confirmDispatch,
    chooseRoute,
    markReviewed,
    regenerateDraft,
    dismiss,
    chat,
  };
}

export type SimController = ReturnType<typeof useGoldenTimeSim>;
