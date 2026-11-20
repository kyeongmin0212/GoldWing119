// G-J 골든타임 윙 — 공용 타입 정의

export type LatLng = { lat: number; lng: number };

/** 내부 계산용 평면 좌표(km). 원점은 지도 좌상단. */
export type XY = { x: number; y: number };

export type ScenarioMode = "urban" | "regional" | "night";

/** awaiting = 드론 투입 판단 카드가 떠서 관제요원 승인을 기다리는 상태 */
export type SimStatus = "idle" | "awaiting" | "running" | "paused" | "finished";

/** 관제권 — 금지가 아니라 비행 승인·관제탑 협의(긴급 공공목적은 통보) 대상 */
export interface ControlZone {
  id: string;
  name: string;
  center: LatLng;
  radiusKm: number;
  note: string;
}

/** 회피구역 — 경로 계산에서 원천 배제 */
export interface NoFlyZone {
  id: string;
  name: string;
  kind: "runway" | "military" | "powerline";
  polygon: LatLng[];
  note: string;
}

export interface RoadSegment {
  /** 구간 끝 지점 */
  to: LatLng;
  /** 신고 시각 기준 예상 평균 속도 (km/h) */
  speedKmh: number;
  label?: string;
  congested?: boolean;
  /** 이 구간이 걸린 혼잡 DB 지점 */
  hotspotId?: string;
  /** 평시(한산) 평균 속도 (km/h). 없으면 혼잡 구간은 50, 그 외는 speedKmh 로 본다 */
  freeFlowKmh?: number;
}

/** 혼잡 DB — 상습 정체·불법주정차 다발 구역 */
export interface Hotspot {
  id: string;
  name: string;
  kind: "상습정체" | "불법주정차다발";
  position: LatLng;
  /** 활성 시간대 [시작시, 끝시) — 없으면 상시 */
  activeHours?: [number, number][];
  source: string;
}

export interface DroneBase {
  id: string;
  name: string;
  position: LatLng;
  /** 거점 보유 대수 */
  capacity: number;
}

export interface ViolationSample {
  id: string;
  plate: string; // 가상 번호판
  vehicleType: string;
  reason: string;
  position: LatLng;
  locationLabel: string;
  confidence: number;
}

export interface Scenario {
  mode: ScenarioMode;
  title: string;
  description: string;
  focus: string;
  station: { name: string; position: LatLng };
  incident: { name: string; position: LatLng; type: string; reportedAt: string };
  truckStart: LatLng;
  truckRoute: RoadSegment[];
  violations: ViolationSample[];
}

export interface HotspotMatch {
  hotspot: Hotspot;
  active: boolean;
  /** 경로상 첫 매칭 구간 인덱스 */
  segIndex: number;
  lastSegIndex: number;
}

export interface HotspotCluster {
  id: string;
  hotspots: Hotspot[];
  firstSeg: number;
  lastSeg: number;
  label: string;
}

export interface DroneAssignment {
  droneId: string;
  base: DroneBase;
  cluster: HotspotCluster;
  role: "guide" | "guide+detect";
}

export interface DispatchDecision {
  reportedAt: string;
  hour: number;
  rushHour: boolean;
  normalSec: number;
  expectedSec: number;
  delaySec: number;
  matches: HotspotMatch[];
  clusters: HotspotCluster[];
  recommend: number; // 0~2
  reasons: string[];
  assignments: DroneAssignment[];
}

export type ViolationStatus =
  | "analyzing"
  | "pending"
  | "submitting"
  | "submitted"
  | "dismissed"
  | "error";

export interface ReportDraft {
  title: string;
  jurisdiction: string;
  /** 좁은 화면용 관할 이름 (예: 남구) */
  jurisdictionShort: string;
  /** 시군구 행정구역 코드 (옛 광주 29xxx / 옛 전남 46xxx) */
  jurisdictionCode: string;
  agency: string;
  plate: string;
  location: string;
  coords: string;
  detectedAt: string;
  violation: string;
  legalBasis: string[];
  requestedAction: string;
  evidence: string[];
  body: string;
}

export interface ViolationRecord extends ViolationSample {
  droneId: string;
  detectedAtSim: number;
  detectedAtIso: string;
  status: ViolationStatus;
  draft?: ReportDraft;
  receiptNo?: string;
  agentMessage?: string;
}

export type AgentName = "route" | "pathfinder" | "vision" | "report" | "system" | "watsonx";

export interface AgentLog {
  id: string;
  agent: AgentName;
  text: string;
  level: "info" | "progress" | "success" | "warn";
  simTime: number;
}

/** /api/agent 요청 */
export type AgentRequest =
  | { type: "violation_detected"; violation: ViolationSample & { detectedAtIso: string }; threadId?: string }
  | { type: "report_approved"; violation: ViolationSample & { detectedAtIso: string }; draft: ReportDraft; threadId?: string }
  | { type: "chat"; message: string; context?: string; threadId?: string };

export interface AgentStep {
  agent: AgentName;
  text: string;
  delayMs: number;
}

/** /api/agent 응답 */
export interface AgentResponse {
  mode: "live" | "mock";
  steps: AgentStep[];
  message: string;
  draft?: ReportDraft;
  receiptNo?: string;
  status?: "pending" | "submitted";
  threadId?: string;
  fallbackReason?: string;
}
