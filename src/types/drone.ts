// G-J 골든타임 윙 — 공용 타입 정의

export type LatLng = { lat: number; lng: number };

/** 내부 계산용 평면 좌표(km). 원점은 지도 좌상단. */
export type XY = { x: number; y: number };

export type ScenarioMode = "urban" | "regional";

/** awaiting = 드론 투입 판단 카드가 떠서 관제요원 승인을 기다리는 상태
 *  rerouting = 선행 드론이 전방 차단을 발견해 우회로 안내 여부를 관제요원이 판단하는 상태 */
export type SimStatus = "idle" | "awaiting" | "running" | "paused" | "rerouting" | "finished";
/** 관제요원의 경로 판단: 우회로 안내 / 기존 경로 유지 */
export type RouteChoice = "detour" | "stay";

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

/** 드론 정찰로 발견하는 전방 막힘 — accident: 도로 막힘(사고 등 돌발), parking: 불법주차로 소방차 진입 곤란 */
export interface RoadBlockage {
  kind: "accident" | "parking";
  /** 막힌 지점이 있는 구간 (기존 경로 기준 인덱스) */
  segIndex: number;
  position: LatLng;
  label: string;
  /** 지도·영상 표식용 짧은 이름 */
  short: string;
  /** 그대로 지나가면 이 구간 속도 (km/h) */
  blockedSpeedKmh: number;
  detour: {
    /** 이 구간부터 segments.length 개 구간을 우회 구간으로 바꾼다 (구간 수는 같게) */
    fromSeg: number;
    segments: RoadSegment[];
    /** 우회 도로 모양을 받을 때 거쳐 갈 점 (막힌 길로 가지 않도록) */
    via?: LatLng[];
    /** 소방차 화면에 띄울 안내 문구 */
    summary: string;
  };
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
  blockage?: RoadBlockage;
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
  | "reviewed"
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
  /** IBM 호출이 두 번 실패해 코드 양식으로 만든 예비 초안 */
  fallback?: boolean;
  agentMessage?: string;
  /** 에이전트가 근거로 쓴 지식 문서 (RAG 출처) */
  sources?: string[];
}

export type AgentName = "route" | "pathfinder" | "vision" | "report" | "system" | "watsonx";

export interface AgentLog {
  id: string;
  agent: AgentName;
  text: string;
  level: "info" | "progress" | "success" | "warn";
  simTime: number;
  /** 에이전트가 근거로 쓴 지식 문서 (RAG 출처) */
  sources?: string[];
}

/** /api/agent 요청 */
export type AgentRequest =
  | { type: "violation_detected"; violation: ViolationSample & { detectedAtIso: string }; threadId?: string }
  | { type: "chat"; message: string; context?: string; threadId?: string };

export interface AgentStep {
  agent: AgentName;
  text: string;
  delayMs: number;
}

/** 화면의 IBM 연결 표시: live 실제 응답 확인 · offline 설정은 있으나 호출 실패(시뮬레이션으로 대체) · mock 설정 없음 · unknown 확인 중 */
export type AgentBackend = "live" | "offline" | "mock" | "unknown";

/** GET /api/agent 응답 — 설정이 있으면 IBM 에 실제로 요청해 본 결과 */
export interface AgentHealth {
  mode: "live" | "offline" | "mock";
  checkedAt: string;
  reason?: string;
}

/** /api/agent 응답 */
export interface AgentResponse {
  mode: "live" | "mock";
  /** true = 설정은 있으나 IBM 호출이 실패해 MOCK 으로 대체한 응답 */
  offline?: boolean;
  steps: AgentStep[];
  message: string;
  draft?: ReportDraft;
  status?: "pending";
  threadId?: string;
  fallbackReason?: string;
  /** 에이전트가 근거로 쓴 지식 문서 (RAG 출처) */
  sources?: string[];
}
