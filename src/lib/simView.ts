// 두 화면(상황실 콘솔, 소방차 태블릿)이 함께 쓰는 읽기용 상태 모양.
// 지도·드론 영상 컴포넌트는 이 타입만 알면 되므로 어느 화면에서든 재사용할 수 있다.

import type { SimPlan } from "@/lib/simulation";
import type {
  DispatchDecision,
  DroneBase,
  Hotspot,
  RouteChoice,
  Scenario,
  ScenarioMode,
  SimStatus,
  ViolationRecord,
} from "@/types/drone";

export interface SimView {
  mode: ScenarioMode;
  scenario: Scenario;
  decision: DispatchDecision;
  /** null = 투입 결정 전, true = 드론 투입, false = 소방차만 */
  launch: boolean | null;
  plan: SimPlan;
  /** 전방 차단 시 경로 판단 (null = 판단 전 또는 해당 없음) */
  routeChoice: RouteChoice | null;
  hotspots: Hotspot[];
  bases: DroneBase[];
  status: SimStatus;
  simTime: number;
  speed: number;
  violations: ViolationRecord[];
  focusDrone: string | null;
  setFocusDrone: (id: string) => void;
  setSelectedId: (id: string | null) => void;
}
