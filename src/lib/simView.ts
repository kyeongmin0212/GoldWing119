// 두 화면(상황실 콘솔, 소방차 태블릿)이 함께 쓰는 읽기용 상태 모양.
// 지도·드론 영상 컴포넌트는 이 타입만 알면 되므로 어느 화면에서든 재사용할 수 있다.

import type { SimPlan } from "@/lib/simulation";
import type {
  ControlZone,
  DispatchDecision,
  DroneBase,
  Hotspot,
  NoFlyZone,
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
  zones: NoFlyZone[];
  controlZones: ControlZone[];
  hotspots: Hotspot[];
  bases: DroneBase[];
  status: SimStatus;
  simTime: number;
  speed: number;
  violations: ViolationRecord[];
  focusDrone: string | null;
  /** 수동 조종 중인 드론 ID (없으면 자동 비행) */
  manualControl: string | null;
  setFocusDrone: (id: string) => void;
  setSelectedId: (id: string | null) => void;
}
