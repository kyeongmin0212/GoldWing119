// 드론 가상 영상용 항공 장면 — 위에서 내려다본 동네 길 (실제 영상·지도 아님, 코드로 그린 가상 장면)
// 굽은 2차선 도로, 옆으로 갈라지는 골목, 길가 상가(간판)와 주택(지붕·마당·담장), 뒷줄 주택·빌라·주차장·공원, 나무, 주차 차량, 오가는 차량.
// 건물·나무는 입체(높이·옆면·창문·지붕·그림자)로 그린다 — 같은 카메라 투영에 높이를 더해 저공 드론 시점처럼 보이게.
// 같은 seed 면 언제나 같은 동네가 나온다. 세계 좌표 단위: 차로 폭 15 (약 3.5m).
// 모든 것은 "도로 좌표"(u = 도로 중심에서 옆으로, wy = 도로를 따라 앞으로)로 배치해 굽은 길을 따라 휘어진다.
// 카메라는 드론 진행 방향이 화면 위쪽이 되도록 돌아가고, 바로 아래가 아니라 앞으로 기울여(원근) 내려다본다.
// 정찰 때는 낮게(약 18m) 날아 가까운 차의 번호판이 보이고, 순항 때는 높이 올라가 거의 바로 아래를 본다.
import { maskPlate } from "./plate.ts";

export const LANE = 15;
export const ROAD_HALF = LANE * 2;
const SIDEWALK = 10;
const BLOCK = 170;
/** 길가 건물 줄의 가장 바깥 (뒷줄 끝) */
const BACK_U = ROAD_HALF + SIDEWALK + 150;

type Ctx = CanvasRenderingContext2D;
type P = [number, number];
/** 도로 좌표 + 높이 (u, wy, z) — z 는 땅에서 위로 (세계 단위) */
export type V3 = [number, number, number];

/** 해가 있는 쪽 (도로 좌표의 수평 방향, 왼쪽 뒤) — 그림자는 반대쪽(오른쪽 앞)으로 높이의 0.7배 */
const SUN_U = -0.6;
const SUN_W = -0.8;
const SHADOW_U = 0.42;
const SHADOW_W = 0.56;

const shadeCache = new Map<string, string>();
/** #rrggbb 색을 f 배 밝기로 (면 음영) */
function shade(hex: string, f: number): string {
  const q = Math.round(f * 20) / 20;
  const key = hex + q;
  let c = shadeCache.get(key);
  if (!c) {
    const n = parseInt(hex.slice(1), 16);
    const ch = (v: number) => Math.min(255, Math.round(v * q));
    c = `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
    shadeCache.set(key, c);
  }
  return c;
}

/** 볼록 껍질 (반시계 방향) — 건물 그림자 모양 */
function hull(pts: P[]): P[] {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cr = (o: P, a: P, b: P) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: P[] = [];
  for (const q of p) {
    while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up: P[] = [];
  for (let i = p.length - 1; i >= 0; i--) {
    const q = p[i];
    while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  lo.pop();
  up.pop();
  return lo.concat(up);
}

function hash(a: number, b = 0, seed = 0): number {
  let h = (a * 374761393 + b * 668265263 + seed * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

export interface RoadFrame {
  /** 도로 중심 x (세계) */
  cx: number;
  /** 진행 방향 각도 (라디안, 위쪽 = 0, 오른쪽으로 휘면 +) */
  angle: number;
}

export interface AerialView {
  /** 화면 가운데(드론 위치) 배율: 세계 1단위 = k 픽셀 */
  k: number;
  W: number;
  H: number;
  /** 카메라 회전 각 (도로 진행 방향) */
  camAngle: number;
  /** 예전 호환용 — 원근 투영은 M 안에서 하므로 아무것도 하지 않는다 */
  apply: (ctx: Ctx) => void;
  /** 도로 좌표 (u, wy) → 화면 픽셀 (원근 투영 포함) */
  M: (u: number, wy: number) => P;
  /** M 과 같음 (글자·상자 위치) */
  screen: (u: number, wy: number) => P;
  /** 그 지점의 배율 (가까울수록 큼) */
  kAt: (u: number, wy: number) => number;
  /** 높이 z 인 점 → 화면 픽셀 (건물 벽·지붕) */
  M3: (u: number, wy: number, z: number) => P;
  /** 높이 z 인 점의 배율 */
  kAt3: (u: number, wy: number, z: number) => number;
  /** 도로 좌표 → (옆 l, 드론 바로 아래에서 앞으로 f) */
  ground: (u: number, wy: number) => P;
  /** 세계 좌표 → (옆 l, 앞 f) */
  groundW: (wx: number, wy: number) => P;
  /** 세계 좌표 → 화면 픽셀 (갈림길 도로) */
  Mw: (wx: number, wy: number) => P;
  /** 화면에 들어오는 앞 거리 f 범위 (여유 포함) */
  fNear: number;
  fFar: number;
  /** 면(pts)이 카메라 쪽을 보는가 — c: 그 입체의 가운데 */
  facing: (pts: V3[], c: V3) => boolean;
  /** 화면에 보이는 도로 방향 범위 */
  wyMin: number;
  wyMax: number;
  /** 화면 표시용 고도(m) */
  altM: number;
  /** 화면 가운데 높이 (조준선) */
  cy: number;
  /** 도로 좌표에 차량 그리기 — extra: 도로 방향 기준 추가 회전, flip: 반대 방향이면 π */
  car: (ctx: Ctx, u: number, wy: number, extra: number, color: string, flip?: number, opt?: CarOpt) => void;
}

export interface CarOpt {
  /** 길이(세계 단위, 기본 19 ≈ 4.4m) — 23 이상이면 화물차 모양 */
  len?: number;
  /** 폭(세계 단위, 기본 9) */
  wid?: number;
  police?: boolean;
  /** 소방차 */
  truck?: boolean;
  blink?: boolean;
  /** 번호판 글자 — 카메라 쪽 앞·뒷면에 크게 보일 때만 글자를 쓴다 */
  plate?: string;
}

/** 차 유리 색 */
const CAR_GLASS = "#2a3a4c";

/** 1m = 세계 몇 단위 (차로 폭 15단위 ≈ 3.5m) */
export const UNITS_PER_M = LANE / 3.5;
const HANGUL_PLATE = "가나다라마거너더러머버서어저고노도로모보소오조구누두루무부수우주";
/** 일반 차량용 가상 번호판 (같은 id 면 같은 번호) */
export function fakePlate(id: number): string {
  const a = 10 + Math.floor(hash(id, 201) * 89);
  const h = HANGUL_PLATE[Math.floor(hash(id, 202) * HANGUL_PLATE.length)];
  const b = 1000 + Math.floor(hash(id, 203) * 8999);
  return `${a}${h} ${b}`;
}

export interface AerialDrawOpts {
  /** 도로를 따라 나아간 거리 (세계 단위) */
  s: number;
  /** 확대 (정찰 1, 순항 0.55) */
  zoom: number;
  /** 시간(초) — 다른 차량 움직임 */
  t: number;
  /** 0~1: 길터주기 방송으로 같은 방향 차량이 가장자리로 비켜선 정도 */
  yieldAmt?: number;
  /** 막힌 지점(도로 공사) — 이 근처 같은 방향 차로에는 달리는 차를 두지 않는다 */
  blockWy?: number;
  /** 진로방해 차량 자리 — 이 근처 오른쪽 길가에는 다른 주차 차량을 두지 않는다 */
  keepClearWy?: number[];
  /** 카메라가 길 방향에서 더 돌아간 각(라디안). 0 = 앞(길이 이어지는 쪽), π = 뒤돌아봄(왔던 길로 되돌아갈 때) */
  turn?: number;
  /** 카메라 방향을 직접 정할 때(세계 기준 라디안) — 주면 turn 대신 쓴다. 뒤돌기·갈림길에서 끊김 없이 돌게 하려고 */
  camAngle?: number;
}

const SHOP_ROOF = ["#d9d6cf", "#c9ccd1", "#e4e0d6", "#b9bdc2", "#d3cbbd", "#cfc7b8"];
const SIGN = ["#c8102e", "#1d4ed8", "#0f766e", "#b45309", "#7c3aed", "#15803d", "#be185d", "#0369a1"];
const HOUSE_ROOF: [string, string][] = [
  ["#9a4a36", "#b65c44"],
  ["#4f5d6e", "#61718a"],
  ["#5f6f52", "#73855f"],
  ["#7a6a5a", "#8f7d6a"],
  ["#3f4a5a", "#556275"],
  ["#8a3b3b", "#a34d4d"],
];
const VILLA_ROOF = ["#e8e4dc", "#d6d9dd", "#ece6da"];
const SHOP_WALL = ["#e7e1d4", "#d5d8dc", "#c9b8a2", "#efece6", "#b9a48c", "#d8cfc0"];
const HOUSE_WALL = ["#efe8da", "#e3dccd", "#d9c6ad", "#f2efe8", "#c8b39a"];
const VILLA_WALL = ["#ece7de", "#d9cbb8", "#b8806a", "#e2e2de", "#c79c84"];
const GLASS = "#33465a";
const WINDOW = "#3e5266";
const CAR = ["#f2f2f0", "#c7cbd0", "#2b2d31", "#7b8088", "#b3262b", "#2f4f8a", "#d8d2c4", "#f2f2f0", "#c7cbd0", "#e9e9e6"];

/**
 * 실제 지도 경로의 진행 방향 표 — 영상 속 길이 지도대로 좌회전·우회전하게 한다.
 * wy0 부터 step 간격마다 진행 방향(라디안, 위쪽 0, 오른쪽으로 꺾이면 +, 이어지게 펼친 값).
 */
export interface RoadPath {
  wy0: number;
  step: number;
  theta: number[];
}

/** 큰길 atWy 지점에서 갈라지는 도로 — step 간격마다 진행 방향(RoadPath 와 같은 기준) */
export interface RoadBranch {
  atWy: number;
  step: number;
  theta: number[];
}

export function createAerialScene(seed = 1) {
  // 경로가 없을 때(대기 화면 등)의 기본 길: 완만하게 굽은 길
  const roadX = (wy: number) => 150 * Math.sin(wy / 330 + seed) + 55 * Math.sin(wy / 140 + seed * 2.1);
  const roadDx = (wy: number) => (150 / 330) * Math.cos(wy / 330 + seed) + (55 / 140) * Math.cos(wy / 140 + seed * 2.1);

  // 지도 경로가 있으면: 진행 방향을 따라 중심선을 이어 붙인 길 (wy = 길을 따라 간 거리)
  let path: { wy0: number; step: number; th: number[]; px: number[]; py: number[] } | null = null;
  function setPath(p: RoadPath | null) {
    if (!p || p.theta.length < 2) {
      path = null;
      return;
    }
    const th = p.theta;
    const px = [0];
    const py = [p.wy0];
    for (let i = 1; i < th.length; i++) {
      const a = (th[i - 1] + th[i]) / 2;
      px.push(px[i - 1] + p.step * Math.sin(a));
      py.push(py[i - 1] + p.step * Math.cos(a));
    }
    path = { wy0: p.wy0, step: p.step, th, px, py };
    branches = [];
  }

  /**
   * 갈림길 도로 — 지금 따라가는 길(큰길)에서 갈라지는 실제 우회로(또는 우회 뒤엔 막힌 기존 길)를 미리 그려 둔다.
   * 그래야 우회를 승인하고 드론이 갈림길로 돌아갔을 때 들어갈 길이 이미 화면에 있다.
   * 큰길 wy 지점에서 시작해 진행 방향 표(theta)대로 이어 붙인다. setPath 다음에 불러야 한다(큰길이 바뀌면 다시).
   */
  let branches: { x: number[]; y: number[]; a: number[]; hits: { u: number; wy: number }[] }[] = [];
  function setBranches(list: RoadBranch[]) {
    branches = [];
    if (!path) return;
    for (const b of list) {
      if (b.theta.length < 2) continue;
      const [x0, y0] = center(b.atWy);
      const x = [x0];
      const y = [y0];
      for (let i = 1; i < b.theta.length; i++) {
        const a = (b.theta[i - 1] + b.theta[i]) / 2;
        x.push(x[i - 1] + b.step * Math.sin(a));
        y.push(y[i - 1] + b.step * Math.cos(a));
      }
      // 큰길 도로 좌표(u, wy)로 본 갈림길 중심선 — 이 자리에 건물·주차 차량을 두지 않는다
      const hits: { u: number; wy: number }[] = [];
      let guess = b.atWy;
      for (let i = 0; i < x.length; i++) {
        let best = { d: Infinity, wy: guess, u: 0 };
        for (let wy = guess - 260; wy <= guess + 260; wy += 3) {
          const [cxx, cyy, a] = center(wy);
          const d = Math.hypot(x[i] - cxx, y[i] - cyy);
          if (d < best.d) best = { d, wy, u: (x[i] - cxx) * Math.cos(a) - (y[i] - cyy) * Math.sin(a) };
        }
        guess = best.wy;
        if (Math.abs(best.u) > 260) break; // 길가 건물 줄보다 멀리 나가면 더 볼 필요 없음
        hits.push({ u: best.u, wy: best.wy });
      }
      branches.push({ x, y, a: b.theta, hits });
    }
  }
  /** 큰길 side 쪽 u0~u1, wy y0~y1 칸에 갈림길 도로가 지나가는가 (도로 폭만큼 여유) */
  const onBranch = (side: number, u0: number, u1: number, y0: number, y1: number): boolean => {
    const m = ROAD_HALF + SIDEWALK + 6;
    for (const b of branches)
      for (const p of b.hits) if (p.u * side > 0 && Math.abs(p.u) > ROAD_HALF * 0.5 /* 큰길과 겹친 곳은 빼고 */ && Math.abs(p.u) > u0 - m && Math.abs(p.u) < u1 + m && p.wy > y0 - m && p.wy < y1 + m) return true;
    return false;
  };

  /** 그 지점의 중심선 (x, y), 진행 방향, 굽은 정도(라디안/단위) */
  const center = (wy: number): [number, number, number, number] => {
    if (!path) return [roadX(wy), wy, Math.atan(roadDx(wy)), 0];
    const { wy0, step, th, px, py } = path;
    const n = th.length - 1;
    const f = (wy - wy0) / step;
    if (f <= 0) return [px[0] + (wy - wy0) * Math.sin(th[0]), py[0] + (wy - wy0) * Math.cos(th[0]), th[0], 0];
    if (f >= n) {
      const d = wy - (wy0 + n * step);
      return [px[n] + d * Math.sin(th[n]), py[n] + d * Math.cos(th[n]), th[n], 0];
    }
    const i = Math.floor(f);
    const t = f - i;
    const a0 = th[i];
    const a1 = th[i + 1];
    const kap = (a1 - a0) / step;
    // 구간 안에서는 방향이 고르게 바뀐다고 보고 위치를 적분
    const am = a0 + (a1 - a0) * t * 0.5;
    const d = t * step;
    return [px[i] + d * Math.sin(am), py[i] + d * Math.cos(am), a0 + (a1 - a0) * t, kap];
  };
  /** wy0~wy1 구간에서 가장 급하게 꺾이는 정도(라디안/단위) — 교차로에서 도는 곳 찾기 */
  const bendAt = (wy0: number, wy1: number): number => {
    if (!path) return 0;
    let m = 0;
    for (let y = wy0; y <= wy1; y += 8) m = Math.max(m, Math.abs(center(y)[3]));
    return m;
  };
  const frame = (wy: number): RoadFrame => {
    const [cx, , angle] = center(wy);
    return { cx, angle };
  };
  /** 도로 좌표 → 세계 좌표 (중심선에서 오른쪽 법선 방향으로 u 만큼) */
  const world = (u: number, wy: number): P => {
    const [x, y, a, kap] = center(wy);
    // 급하게 꺾이는 곳 안쪽은 굽은 반지름보다 멀리 두면 접혀 보이므로 반지름 안쪽으로 눌러 둔다
    if (u * kap > 0.85) u = 0.85 / kap;
    return [x + u * Math.cos(a), y - u * Math.sin(a)];
  };

  let asphalt: CanvasPattern | null = null;
  let asphaltSrc: HTMLCanvasElement | null = null;
  function asphaltPattern(ctx: Ctx): CanvasPattern | string {
    if (typeof document === "undefined") return "#5f6368";
    if (!asphaltSrc) {
      asphaltSrc = document.createElement("canvas");
      asphaltSrc.width = asphaltSrc.height = 160;
      const g = asphaltSrc.getContext("2d")!;
      g.fillStyle = "#5c6065";
      g.fillRect(0, 0, 160, 160);
      for (let i = 0; i < 2600; i++) {
        const v = 70 + Math.floor(hash(i, 1, seed) * 45);
        g.fillStyle = `rgba(${v},${v + 2},${v + 5},${0.35 + hash(i, 2, seed) * 0.4})`;
        g.fillRect(hash(i, 3, seed) * 160, hash(i, 4, seed) * 160, 1 + hash(i, 5) * 1.6, 1 + hash(i, 6) * 1.6);
      }
      // 땜질 자국(어두운 네모)은 넣지 않는다 — 무늬가 화면에 고정돼 차도 위에 그림자처럼 떠 보였음
    }
    if (!asphalt) asphalt = ctx.createPattern(asphaltSrc, "repeat");
    return asphalt ?? "#5f6368";
  }

  /**
   * 기울인 카메라(핀홀) 투영. 순항·정찰 모두 앞으로 기울인 같은 각도(수평에서 약 42° 아래)로 본다.
   * zoom 1 = 정찰(낮게), 작을수록 높이 떠서 넓게 본다. 화면 가운데(cy)에 드론 위치(s)가 오고, 화면 위쪽일수록 앞쪽 먼 곳이 작게 보인다.
   */
  function makeView(W: number, H: number, s: number, zoom: number, turn = 0, camAbs?: number): AerialView {
    // 카메라 방향을 직접 받으면, 그 지점 길 방향과의 차이를 turn 으로 본다 (그릴 범위 앞/뒤 판단용)
    if (camAbs !== undefined) turn = camAbs - center(s)[2];
    // 화면 가운데 배율 — 영상 칸이 납작하면(노트북 화면) 높이 기준으로 줄여 카메라를 조금 높이 띄운다.
    // 그래야 25m 앞 막힌 현장이 위쪽 안내 띠에 가리지 않고 화면 가운데 쪽에 온다
    const kc = (Math.min(W, 1.3 * H) / 340) * zoom * 2.3;
    const theta = 0.74; // 광축이 수평에서 내려간 각 (라디안, 약 42°) — 순항 때도 바로 아래가 아니라 앞을 본다
    // 초점 거리(픽셀) — 너무 짧으면(광각) 길이 화면 위로 갈수록 V자로 급하게 좁아 보이고,
    // 너무 길면 앞이 덜 보여 25m 앞에 멈췄을 때 막힌 현장이 화면 위로 잘린다 → 그 사이 값
    // 영상 칸이 납작하면(노트북 화면) 위아래로 덜 보이므로 높이에 맞춰 조금 넓게 본다
    const F = Math.min(0.85 * W, 1.25 * H);
    const h = (F * Math.sin(theta)) / kc; // 카메라 높이(세계 단위)
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const lookAhead = h / Math.tan(theta); // 바로 아래 지점에서 화면 가운데 지점까지
    const cx = W / 2;
    const cy = H * 0.8; // 드론 위치를 화면 아래쪽에 — 앞쪽을 넓게 본다 (정찰 때 앞 약 50m)
    // 화면 가운데 지점과 카메라 방향 — 카메라는 조금 앞쪽 길 방향을 보며 돌아간다 (꺾이는 곳에서 미리 돈다)
    const [camX, camY] = path ? center(s) : [roadX(s + 25), s];
    // 되돌아가는 중(turn > 90°)이면 뒤쪽 길 방향을 미리 본다
    const back = Math.cos(turn) < 0 ? -1 : 1;
    const camAngle = camAbs ?? 0.75 * center(s + 30 * back)[2] + 0.25 * center(s + 90 * back)[2] + turn;
    const c = Math.cos(-camAngle);
    const sn = Math.sin(-camAngle);
    /** 도로 좌표 → (옆 l, 바로 아래 지점에서 앞으로 f) */
    const ground = (u: number, wy: number): P => {
      const [wx, wyy] = world(u, wy);
      return groundW(wx, wyy);
    };
    /** 세계 좌표 → (옆 l, 앞 f) — 갈림길 도로처럼 큰길 도로 좌표로 나타낼 수 없는 것 */
    const groundW = (wx: number, wyy: number): P => {
      const x = wx - camX;
      const y = -(wyy - camY);
      const l = x * c - y * sn;
      const yd = x * sn + y * c;
      return [l, -yd + lookAhead];
    };
    const zcOf = (f: number) => Math.max(h * 0.08, f * cosT + h * sinT);
    const M = (u: number, wy: number): P => {
      const [l, f] = ground(u, wy);
      const zc = zcOf(f);
      return [cx + (F * l) / zc, cy + (F * (h * cosT - f * sinT)) / zc];
    };
    const Mw = (wx: number, wyy: number): P => {
      const [l, f] = groundW(wx, wyy);
      const zc = zcOf(f);
      return [cx + (F * l) / zc, cy + (F * (h * cosT - f * sinT)) / zc];
    };
    const kAt =(u: number, wy: number) => F / zcOf(ground(u, wy)[1]);
    // 높이 z 인 점: 카메라 높이를 h - z 로 보고 같은 식으로 투영.
    // 화면 아래 끝 너머(카메라 바로 근처)의 높은 점은 카메라 뒤로 넘어가지 않게 높이를 눌러 둔다 (그곳은 화면 밖)
    const zEff = (f: number, z: number) => Math.min(z, Math.max(0, h * 0.75 + (f * cosT) / sinT));
    const zc3 = (f: number, z: number) => Math.max(h * 0.05, f * cosT + (h - zEff(f, z)) * sinT);
    const M3 = (u: number, wy: number, z: number): P => {
      const [l, f] = ground(u, wy);
      const zz = zEff(f, z);
      const zc = zc3(f, z);
      return [cx + (F * l) / zc, cy + (F * ((h - zz) * cosT - f * sinT)) / zc];
    };
    const kAt3 = (u: number, wy: number, z: number) => F / zc3(ground(u, wy)[1], z);
    const facing = (pts: V3[], c: V3): boolean => {
      const [al, af] = ground(pts[0][0], pts[0][1]);
      const [bl, bf] = ground(pts[1][0], pts[1][1]);
      const [dl, df] = ground(pts[2][0], pts[2][1]);
      const e1 = [bl - al, bf - af, pts[1][2] - pts[0][2]];
      const e2 = [dl - al, df - af, pts[2][2] - pts[0][2]];
      const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      let mu = 0;
      let mw = 0;
      let mz = 0;
      for (const p of pts) {
        mu += p[0];
        mw += p[1];
        mz += p[2];
      }
      mu /= pts.length;
      mw /= pts.length;
      mz /= pts.length;
      const [ml, mf] = ground(mu, mw);
      const [cl, cf] = ground(c[0], c[1]);
      const out = n[0] * (ml - cl) + n[1] * (mf - cf) + n[2] * (mz - c[2]);
      const toCam = n[0] * -ml + n[1] * -mf + n[2] * (h - mz);
      return out * toCam > 0;
    };
    // 화면 위·아래 끝에 해당하는 앞 거리 → 그릴 범위
    const fAtRow = (py: number) => {
      const r = (py - cy) / F;
      return (h * (cosT - r * sinT)) / (sinT + r * cosT);
    };
    const rTop = (0 - cy) / F;
    const fTop = sinT + rTop * cosT > 0.02 ? fAtRow(0) : h * 12;
    const fBot = fAtRow(H);
    // 그릴 범위: 앞을 볼 때는 앞쪽, 뒤돌아볼 때는 뒤쪽, 도는 중간에는 양쪽 다
    const fwdMin = s + (fBot - lookAhead) - 60;
    const fwdMax = s + (Math.min(fTop, h * 12) - lookAhead) + 60;
    const backMin = s - (Math.min(fTop, h * 12) - lookAhead) - 60;
    const backMax = s - (fBot - lookAhead) + 60;
    const ct = Math.cos(turn);
    const wyMin = ct > 0.95 ? fwdMin : ct < -0.95 ? backMin : Math.min(fwdMin, backMin);
    const wyMax = ct > 0.95 ? fwdMax : ct < -0.95 ? backMax : Math.max(fwdMax, backMax);
    /**
     * 입체 차량: 건물과 같은 투영으로 낮은 상자(차체) + 그 위 작은 상자(유리 객실)를 그린다.
     * 어느 방향으로 달려도 카메라 쪽 옆면·앞뒤면이 제 방향(화면 아래쪽)에 붙는다. 번호판은 카메라 쪽 앞·뒷면에.
     * 차 로컬 좌표: x = 오른쪽, y = 뒤쪽(앞은 -y), 단위는 세계 단위.
     */
    const car: AerialView["car"] = (ctx, u, wy, extra, color, flip = 0, opt = {}) => {
      const hd = extra + flip;
      const fu = Math.sin(hd); // 앞 방향 (도로 좌표)
      const fw = Math.cos(hd);
      const ru = fw; // 오른쪽 방향
      const rw = -fu;
      const L = opt.len ?? 19;
      const Wd = opt.wid ?? 9;
      const lorry = !opt.truck && L >= 23;
      const H = opt.truck ? 11 : lorry ? 10 : 6.2;
      const road = (x: number, y: number): P => [u + ru * x - fu * y, wy + rw * x - fw * y];
      const P3 = (x: number, y: number, z: number): P => {
        const [uu, ww] = road(x, y);
        return M3(uu, ww, z);
      };
      const R3 = (x: number, y: number, z: number): V3 => {
        const [uu, ww] = road(x, y);
        return [uu, ww, z];
      };
      const poly = (pts: P[]) => {
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
      };
      /** 평면(높이 z) 위에 차 로컬 단위로 그리기 — 작은 차 하나 크기라 아핀 근사로 충분 */
      const onPlane = (z: number, draw: () => void) => {
        const o = P3(0, 0, z);
        const ex = P3(1, 0, z);
        const ey = P3(0, 1, z);
        ctx.save();
        ctx.transform(ex[0] - o[0], ex[1] - o[1], ey[0] - o[0], ey[1] - o[1], o[0], o[1]);
        draw();
        ctx.restore();
      };
      /** 앞(-1)·뒤(+1) 끝면 위에 그리기: 가로 = 화면 왼→오른쪽, 세로 = 아래로(-z) */
      const onEnd = (end: number, draw: () => void) => {
        const yE = (end * L) / 2;
        const o = P3(0, yE, 0);
        const ex = P3(1, yE, 0);
        const ez = P3(0, yE, 1);
        const d = ex[0] - o[0] < 0 ? -1 : 1;
        ctx.save();
        ctx.transform(d * (ex[0] - o[0]), d * (ex[1] - o[1]), -(ez[0] - o[0]), -(ez[1] - o[1]), o[0], o[1]);
        draw();
        ctx.restore();
      };
      const light = (nu: number, nw: number) => 0.64 + 0.34 * Math.max(0, nu * SUN_U + nw * SUN_W);
      type Side = "left" | "right" | "front" | "back";
      /** 상자 한 칸: 보이는 옆면만 음영 넣어 칠하고, 윗면은 top() 으로 */
      const block = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, wall: string | ((s: Side, f: number) => string), top: () => void, onSide?: (s: Side) => void) => {
        const c: V3 = R3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        const sides: [Side, number, number, number, number, number, number][] = [
          ["left", x0, y1, x0, y0, -ru, -rw],
          ["right", x1, y0, x1, y1, ru, rw],
          ["front", x0, y0, x1, y0, fu, fw],
          ["back", x1, y1, x0, y1, -fu, -fw],
        ];
        for (const [s, ax, ay, bx, by, nu, nw] of sides) {
          const pts: V3[] = [R3(ax, ay, z0), R3(bx, by, z0), R3(bx, by, z1), R3(ax, ay, z1)];
          if (!facing(pts, c)) continue;
          const f = light(nu, nw);
          poly([P3(ax, ay, z0), P3(bx, by, z0), P3(bx, by, z1), P3(ax, ay, z1)]);
          ctx.fillStyle = typeof wall === "string" ? shade(wall, f) : wall(s, f);
          ctx.fill();
          onSide?.(s);
        }
        top();
      };

      // 그림자 (땅 위)
      const foot: P[] = [road(-Wd / 2, -L / 2), road(Wd / 2, -L / 2), road(Wd / 2, L / 2), road(-Wd / 2, L / 2)];
      const sh = hull([...foot, ...foot.map(([a, b]): P => [a + SHADOW_U * H, b + SHADOW_W * H])]);
      poly(sh.map(([a, b]) => M(a, b)));
      ctx.fillStyle = "rgba(10,14,20,0.32)";
      ctx.fill();

      /** 카메라 쪽 끝면의 등·범퍼·번호판 (zb: 차체 높이) */
      const endDetail = (end: number, zb: number) => {
        const pw = Wd * 0.5;
        const ph = Math.min(1.5, zb * 0.36);
        const pz = zb * 0.42; // 번호판 가운데 높이
        const ez = P3(0, (end * L) / 2, 1);
        const eo = P3(0, (end * L) / 2, 0);
        const pxPerUnit = Math.hypot(ez[0] - eo[0], ez[1] - eo[1]);
        if (pxPerUnit * zb < 3) return;
        onEnd(end, () => {
          ctx.fillStyle = "rgba(20,24,30,0.5)";
          ctx.fillRect(-Wd / 2, -zb * 0.2, Wd, zb * 0.16);
          ctx.fillStyle = end > 0 ? "#dc2626" : "#fef3c7";
          const lw = Wd * 0.2;
          ctx.fillRect(-Wd / 2 + 0.4, -zb * 0.88, lw, zb * 0.2);
          ctx.fillRect(Wd / 2 - 0.4 - lw, -zb * 0.88, lw, zb * 0.2);
          ctx.fillStyle = "#f4f6f8";
          ctx.fillRect(-pw / 2, -pz - ph / 2, pw, ph);
          ctx.strokeStyle = "rgba(30,40,55,0.7)";
          ctx.lineWidth = 0.12;
          ctx.strokeRect(-pw / 2, -pz - ph / 2, pw, ph);
          if (opt.plate && ph * pxPerUnit >= 4.5) {
            // 작은 글꼴은 흐려지므로 10배로 쓰고 줄인다
            ctx.save();
            ctx.translate(0, -pz);
            ctx.scale(0.1, 0.1);
            ctx.fillStyle = "#111827";
            ctx.font = `bold ${ph * 8.2}px "Malgun Gothic", sans-serif`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(maskPlate(opt.plate), 0, ph * 0.4, pw * 9.4);
            ctx.restore();
          }
        });
      };
      const glass = (_s: Side, f: number) => shade(CAR_GLASS, 0.75 + 0.35 * f);

      if (opt.truck) {
        // 소방차: 빨간 상자 + 옆면 흰 띠 + 앞 유리 + 지붕(흰 장비함·사다리·경광등)
        block(-Wd / 2, Wd / 2, -L / 2, L / 2, 0, H, color, () =>
          onPlane(H, () => {
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.roundRect(-Wd / 2, -L / 2, Wd, L, 1);
            ctx.fill();
            ctx.fillStyle = "#e9e7e2";
            ctx.fillRect(-Wd / 2 + 1.5, -L / 2 + L * 0.2, Wd - 3, L * 0.7);
            ctx.fillStyle = "#b8b4ac";
            for (let i = 0; i < 4; i++) ctx.fillRect(-Wd / 2 + 2.2, -L / 2 + L * (0.26 + i * 0.16), Wd - 4.4, 1);
            ctx.fillStyle = opt.blink ? "#ef4444" : "#fca5a5";
            ctx.fillRect(-Wd / 2 + 1, -L / 2 + L * 0.08, Wd / 2 - 1, 2);
            ctx.fillStyle = opt.blink ? "#fca5a5" : "#ef4444";
            ctx.fillRect(0, -L / 2 + L * 0.08, Wd / 2 - 1, 2);
          }), (s) => {
            if (s === "left" || s === "right") {
              // 옆면 흰 띠: 옆면 위에 얇은 상자 대신 띠 다각형
              const x = s === "left" ? -Wd / 2 : Wd / 2;
              poly([P3(x, -L / 2, 3), P3(x, L / 2, 3), P3(x, L / 2, 4.3), P3(x, -L / 2, 4.3)]);
              ctx.fillStyle = "rgba(240,238,232,0.9)";
              ctx.fill();
              poly([P3(x, -L / 2 + 0.6, 6), P3(x, -L / 2 + L * 0.18, 6), P3(x, -L / 2 + L * 0.18, 9.5), P3(x, -L / 2 + 0.6, 9.5)]);
              ctx.fillStyle = CAR_GLASS;
              ctx.fill();
            } else if (s === "front") {
              onEnd(-1, () => {
                ctx.fillStyle = CAR_GLASS;
                ctx.fillRect(-Wd / 2 + 0.8, -9.6, Wd - 1.6, 3.6);
              });
              endDetail(-1, 5.5);
            } else endDetail(1, 5.5);
          });
        return;
      }

      if (lorry) {
        // 화물차: 앞 운전석(낮음, 유리) + 뒤 짐칸(높음)
        const cabEnd = -L / 2 + L * 0.3;
        block(-Wd / 2, Wd / 2, -L / 2, cabEnd, 0, 7.5, color, () => onPlane(7.5, () => {
          ctx.fillStyle = shade(color, 0.92);
          ctx.fillRect(-Wd / 2, -L / 2, Wd, cabEnd + L / 2);
        }), (s) => {
          if (s === "front") {
            onEnd(-1, () => {
              ctx.fillStyle = CAR_GLASS;
              ctx.fillRect(-Wd / 2 + 0.7, -6.9, Wd - 1.4, 2.6);
            });
            endDetail(-1, 4);
          } else if (s === "left" || s === "right") {
            const x = s === "left" ? -Wd / 2 : Wd / 2;
            poly([P3(x, -L / 2 + 0.8, 4.3), P3(x, cabEnd - 0.8, 4.3), P3(x, cabEnd - 0.8, 6.9), P3(x, -L / 2 + 0.8, 6.9)]);
            ctx.fillStyle = CAR_GLASS;
            ctx.fill();
          }
        });
        block(-Wd / 2, Wd / 2, cabEnd + 0.6, L / 2, 0, H, color, () => onPlane(H, () => {
          ctx.fillStyle = shade(color, 1.05);
          ctx.fillRect(-Wd / 2, cabEnd + 0.6, Wd, L / 2 - cabEnd - 0.6);
          ctx.strokeStyle = "rgba(0,0,0,0.18)";
          ctx.lineWidth = 0.3;
          ctx.strokeRect(-Wd / 2, cabEnd + 0.6, Wd, L / 2 - cabEnd - 0.6);
        }), (s) => {
          if (s === "back") endDetail(1, 4);
        });
        return;
      }

      // 승용차: 아래 차체(본네트·트렁크) + 위 유리 객실 + 지붕
      const zb = 3.4;
      const cy0 = -L / 2 + L * 0.3; // 앞 유리 시작
      const cy1 = -L / 2 + L * 0.8; // 뒤 유리 끝
      const ci = 0.9; // 객실 좌우 들여쓰기
      block(-Wd / 2, Wd / 2, -L / 2, L / 2, 0, zb, color, () => onPlane(zb, () => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(-Wd / 2, -L / 2, Wd, L, 2.2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.22)";
        ctx.lineWidth = 0.35;
        ctx.stroke();
      }), (s) => {
        if (s === "front") endDetail(-1, zb);
        else if (s === "back") endDetail(1, zb);
      });
      block(-Wd / 2 + ci, Wd / 2 - ci, cy0, cy1, zb, H, glass, () => onPlane(H, () => {
        // 위에서 보이는 앞·뒤 유리 → 그 안쪽 지붕
        ctx.fillStyle = CAR_GLASS;
        ctx.fillRect(-Wd / 2 + ci, cy0, Wd - 2 * ci, cy1 - cy0);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.roundRect(-Wd / 2 + ci + 0.3, cy0 + 1.2, Wd - 2 * ci - 0.6, cy1 - cy0 - 2, 1.2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(-Wd / 2 + ci + 0.8, cy0 + 2, (Wd - 2 * ci) * 0.35, (cy1 - cy0) * 0.45);
        if (opt.police) {
          ctx.fillStyle = opt.blink ? "#ef4444" : "#7f1d1d";
          ctx.fillRect(-Wd / 2 + ci + 0.4, -0.8, Wd / 2 - ci - 0.4, 1.6);
          ctx.fillStyle = opt.blink ? "#1e3a8a" : "#3b82f6";
          ctx.fillRect(0, -0.8, Wd / 2 - ci - 0.4, 1.6);
        }
      }));
    };
    return {
      k: kc,
      W,
      H,
      camAngle,
      M,
      screen: M,
      kAt,
      M3,
      kAt3,
      ground,
      groundW,
      Mw,
      fNear: fBot - 80,
      fFar: Math.min(fTop, h * 12) + 80,
      facing,
      wyMin,
      wyMax,
      altM: h / UNITS_PER_M,
      cy,
      car,
      apply: () => {},
    };
  }

  /** 골목: 구간마다 왼쪽/오른쪽(또는 양쪽)으로 갈라지는 길 */
  function alleysOf(i: number): { side: -1 | 1; wy: number; w: number }[] {
    const r = hash(i, 11, seed);
    if (r > 0.75) return [];
    const wy = i * BLOCK + 45 + hash(i, 12, seed) * 80;
    const w = 24 + hash(i, 13, seed) * 10;
    if (r < 0.2) return [{ side: -1, wy, w }, { side: 1, wy, w }];
    return [{ side: r < 0.48 ? -1 : 1, wy, w }];
  }

  function draw(ctx: Ctx, W: number, H: number, o: AerialDrawOpts): AerialView {
    const v = makeView(W, H, o.s, o.zoom, o.turn ?? 0, o.camAngle);
    const { k, M } = v;
    const yLo = v.wyMin;
    const yHi = v.wyMax;

    ctx.save();
    ctx.fillStyle = "#c3bfb5";
    ctx.fillRect(0, 0, W, H);

    const quad = (u0: number, u1: number, y0: number, y1: number) => {
      const steps = Math.max(1, Math.ceil((y1 - y0) / 14));
      ctx.beginPath();
      for (let j = 0; j <= steps; j++) {
        const [x, y] = M(u0, y0 + ((y1 - y0) * j) / steps);
        if (j === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      for (let j = steps; j >= 0; j--) {
        const [x, y] = M(u1, y0 + ((y1 - y0) * j) / steps);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    const fillQuad = (u0: number, u1: number, y0: number, y1: number, fill: string | CanvasPattern) => {
      quad(u0, u1, y0, y1);
      ctx.fillStyle = fill;
      ctx.fill();
    };

    // ── 입체(건물·나무) 그리기 도구 ──
    /** 그림자 모양(땅 위, 도로 좌표) — 모아 두었다가 길을 그린 다음 한 번에 칠한다 */
    const shadowPolys: P[][] = [];
    /** 입체들 — 길·차 다음에 먼 것부터 그린다 (가까운 건물이 먼 것을 가림) */
    const solids: { d: number; f: () => void }[] = [];
    const addSolid = (u: number, wy: number, f: () => void) => {
      const [sx] = M(u, wy);
      if (sx < -W * 0.7 || sx > W * 1.7) return;
      const [l, ff] = v.ground(u, wy);
      solids.push({ d: l * l + ff * ff, f });
    };
    /** 꼭짓점(높이 포함)들이 땅에 드리우는 그림자 */
    const castShadow = (pts: V3[]) => {
      const flat: P[] = [];
      for (const [u, wy, z] of pts) {
        flat.push([u, wy]);
        if (z > 0) flat.push([u + SHADOW_U * z, wy + SHADOW_W * z]);
      }
      shadowPolys.push(hull(flat));
    };
    /** 창문 같은 잔무늬는 가까이(크게) 보일 때만 */
    const fine = (u: number, wy: number) => v.kAt(u, wy) > 1.05;
    const path3 = (pts: V3[]) => {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const [x, y] = v.M3(pts[i][0], pts[i][1], pts[i][2]);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
    };
    const fill3 = (pts: V3[], color: string) => {
      path3(pts);
      ctx.fillStyle = color;
      ctx.fill();
    };
    /** 벽 바깥 방향이 해를 얼마나 향하는지 → 밝기 */
    const wallLight = (a: P, b: P, c: V3) => {
      let nu = b[1] - a[1];
      let nw = -(b[0] - a[0]);
      const len = Math.hypot(nu, nw) || 1;
      if (nu * ((a[0] + b[0]) / 2 - c[0]) + nw * ((a[1] + b[1]) / 2 - c[1]) < 0) {
        nu = -nu;
        nw = -nw;
      }
      return 0.64 + 0.34 * Math.max(0, (nu * SUN_U + nw * SUN_W) / len);
    };
    type Wall = { a: P; b: P; kind: "in" | "out" | "near" | "far"; len: number };
    /** 벽 위 띠(간판·필로티 등): a→b 밑변의 t0~t1, 높이 z0~z1 */
    const band = (w: Wall, z0: number, z1: number, color: string, t0 = 0, t1 = 1) => {
      const at = (t: number, z: number): V3 => [w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t, z];
      fill3([at(t0, z0), at(t1, z0), at(t1, z1), at(t0, z1)], color);
    };
    /** 벽 위 창문 여러 개를 한 경로로 — rows: 층별 [아래, 위] 높이, cols: 가로 개수 */
    const panes = (w: Wall, rows: [number, number][], cols: number, color: string, m = 0.08, gap = 0.2) => {
      ctx.beginPath();
      const at = (t: number, z: number) => v.M3(w.a[0] + (w.b[0] - w.a[0]) * t, w.a[1] + (w.b[1] - w.a[1]) * t, z);
      for (const [z0, z1] of rows) {
        for (let c = 0; c < cols; c++) {
          const t0 = m + ((1 - 2 * m) * (c + gap)) / cols;
          const t1 = m + ((1 - 2 * m) * (c + 1 - gap)) / cols;
          const p0 = at(t0, z0);
          const p1 = at(t1, z0);
          const p2 = at(t1, z1);
          const p3 = at(t0, z1);
          ctx.moveTo(p0[0], p0[1]);
          ctx.lineTo(p1[0], p1[1]);
          ctx.lineTo(p2[0], p2[1]);
          ctx.lineTo(p3[0], p3[1]);
          ctx.closePath();
        }
      }
      ctx.fillStyle = color;
      ctx.fill();
    };
    /** 네 벽 중 a(u0, 도로 쪽)·b(u1, 바깥) 기준 벽 목록 */
    const wallsOf = (u0: number, u1: number, y0: number, y1: number): Wall[] => [
      { a: [u0, y0], b: [u0, y1], kind: "in", len: Math.abs(y1 - y0) },
      { a: [u1, y1], b: [u1, y0], kind: "out", len: Math.abs(y1 - y0) },
      { a: [u0, y0], b: [u1, y0], kind: "near", len: Math.abs(u1 - u0) },
      { a: [u1, y1], b: [u0, y1], kind: "far", len: Math.abs(u1 - u0) },
    ];
    /** 평지붕 상자 (상가·빌라·옥상 시설). 보이는 벽만 음영 넣어 칠하고 지붕은 맨 나중에 */
    const drawBox = (u0: number, u1: number, y0: number, y1: number, z0: number, z1: number, wall: string, roof: string, onWall?: (w: Wall) => void, onRoof?: () => void) => {
      const c: V3 = [(u0 + u1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
      for (const w of wallsOf(u0, u1, y0, y1)) {
        const pts: V3[] = [
          [w.a[0], w.a[1], z0],
          [w.b[0], w.b[1], z0],
          [w.b[0], w.b[1], z1],
          [w.a[0], w.a[1], z1],
        ];
        if (!v.facing(pts, c)) continue;
        fill3(pts, shade(wall, wallLight(w.a, w.b, c)));
        onWall?.(w);
      }
      fill3(
        [
          [u0, y0, z1],
          [u1, y0, z1],
          [u1, y1, z1],
          [u0, y1, z1],
        ],
        roof,
      );
      ctx.strokeStyle = "rgba(0,0,0,0.2)";
      ctx.lineWidth = 1;
      ctx.stroke();
      onRoof?.();
    };
    /** 박공지붕 주택: 벽 높이 zw, 용마루 높이 zr (용마루는 도로와 나란히) */
    const drawGable = (u0: number, u1: number, y0: number, y1: number, zw: number, zr: number, wall: string, roof: string, onWall?: (w: Wall) => void) => {
      const um = (u0 + u1) / 2;
      const c: V3 = [um, (y0 + y1) / 2, zw / 2];
      for (const w of wallsOf(u0, u1, y0, y1)) {
        const end = w.kind === "near" || w.kind === "far";
        const pts: V3[] = end
          ? [
              [w.a[0], w.a[1], 0],
              [w.b[0], w.b[1], 0],
              [w.b[0], w.b[1], zw],
              [um, w.a[1], zr],
              [w.a[0], w.a[1], zw],
            ]
          : [
              [w.a[0], w.a[1], 0],
              [w.b[0], w.b[1], 0],
              [w.b[0], w.b[1], zw],
              [w.a[0], w.a[1], zw],
            ];
        if (!v.facing(pts, c)) continue;
        fill3(pts, shade(wall, wallLight(w.a, w.b, c)));
        onWall?.(w);
      }
      // 처마가 조금 나온 두 지붕면
      const sg = Math.sign(u1 - u0) || 1;
      const e = 1.6;
      const slope = (zr - zw) / Math.abs(um - u0);
      const ze = zw - e * slope;
      for (const [ue, lit] of [
        [u0 - sg * e, sg > 0 ? 1 : 0],
        [u1 + sg * e, sg > 0 ? 0 : 1],
      ] as const) {
        const pts: V3[] = [
          [ue, y0 - e, ze],
          [ue, y1 + e, ze],
          [um, y1 + e, zr],
          [um, y0 - e, zr],
        ];
        if (!v.facing(pts, c)) continue;
        fill3(pts, shade(roof, lit ? 1 : 0.8));
        ctx.strokeStyle = "rgba(0,0,0,0.22)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    };
    /** 나무: 줄기 + 높이 있는 수관(동그란 잎), 그림자는 땅에 */
    const tree3 = (u: number, wy: number, r: number) => {
      const zt = 6 + r * 1.3;
      const su = u + SHADOW_U * zt;
      const sw = wy + SHADOW_W * zt;
      const circ: P[] = [];
      for (let a = 0; a < 10; a++) circ.push([su + r * Math.cos((a / 10) * Math.PI * 2), sw + r * Math.sin((a / 10) * Math.PI * 2)]);
      shadowPolys.push(circ);
      addSolid(u, wy, () => {
        const [bx, by] = M(u, wy);
        const [x, y] = v.M3(u, wy, zt);
        const kk = v.kAt3(u, wy, zt);
        const tr = r * kk;
        ctx.strokeStyle = "#6b4f36";
        ctx.lineWidth = Math.max(1, 1.3 * kk);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.fillStyle = "#3f6a2f";
        ctx.beginPath();
        ctx.arc(x, y, tr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#56853f";
        ctx.beginPath();
        ctx.arc(x - tr * 0.18, y - tr * 0.2, tr * 0.72, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.beginPath();
        ctx.arc(x - tr * 0.35, y - tr * 0.38, tr * 0.36, 0, Math.PI * 2);
        ctx.fill();
      });
    };

    const pat = asphaltPattern(ctx);
    const i0 = Math.floor(yLo / BLOCK);
    const i1 = Math.ceil(yHi / BLOCK);
    const inAlley = (side: number, y0: number, y1: number, list: { side: number; wy: number; w: number }[]) =>
      list.some((a) => a.side === side && y1 > a.wy - a.w / 2 - 3 && y0 < a.wy + a.w / 2 + 3);

    // 1) 골목 (아스팔트 띠)
    for (let i = i0; i <= i1; i++) {
      for (const a of alleysOf(i)) {
        if (bendAt(a.wy - a.w, a.wy + a.w) * 420 > 0.35) continue;
        const u0 = a.side * (ROAD_HALF - 1);
        const u1 = a.side * 420;
        const steps = 30;
        ctx.beginPath();
        for (let j = 0; j <= steps; j++) {
          const u = u0 + ((u1 - u0) * j) / steps;
          const [x, y] = M(u, a.wy - a.w / 2);
          if (j === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        for (let j = steps; j >= 0; j--) {
          const u = u0 + ((u1 - u0) * j) / steps;
          const [x, y] = M(u, a.wy + a.w / 2);
          ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = pat;
        ctx.fill();
      }
    }

    // 2) 땅(마당·주차장·공원)은 지금 칠하고, 건물·나무(입체)와 그 그림자는 모아 두었다가 길·차 다음에
    for (let i = i0; i <= i1; i++) {
      const alleys = alleysOf(i);
      for (const side of [-1, 1] as const) {
        const frontKind = hash(i, side + 20, seed) < 0.55 ? "shop" : "house";
        let y = i * BLOCK;
        let n = 0;
        while (y < (i + 1) * BLOCK - 8) {
          const id = i * 41 + n * 2 + (side > 0 ? 1 : 0);
          const len = frontKind === "shop" ? 26 + hash(id, 30, seed) * 22 : 36 + hash(id, 31, seed) * 18;
          const y0 = y + 2;
          const y1 = Math.min(y + len - 2, (i + 1) * BLOCK - 2);
          y += len;
          n++;
          if (inAlley(side, y0, y1, alleys)) continue;
          // 갈림길 도로가 지나가는 칸은 비워 둔다 (앞줄·뒷줄 따로)
          const frontHit = onBranch(side, ROAD_HALF + SIDEWALK, ROAD_HALF + SIDEWALK + 72, y0, y1);
          const backHit = onBranch(side, ROAD_HALF + SIDEWALK + 72, BACK_U + 50, y0, y1);
          // 교차로에서 도는 곳은 건물 대신 모퉁이 공원(잔디·나무) — 길을 따라 놓은 건물은 바깥쪽이 부채꼴로 늘어나고
          // 안쪽은 접혀 보이지만, 평평한 잔디와 둥근 나무는 꺾여도 어색하지 않다
          if (bendAt(y0 - 20, y1 + 20) * BACK_U > 0.35) {
            fillQuad(side * (ROAD_HALF + SIDEWALK), side * (BACK_U + 220), y0 - 2, y1 + 2, "#9caf7a");
            const kap = center((y0 + y1) / 2)[3];
            for (let q = 0; q < 4 && !frontHit && !backHit; q++) {
              const tu = side * (ROAD_HALF + SIDEWALK + 12 + q * 38 + hash(id, 140 + q, seed) * 14);
              if (tu * kap > 0.6) continue; // 안쪽 모퉁이 깊은 곳은 눌려 있어 나무가 겹친다
              tree3(tu, y0 + (y1 - y0) * (0.2 + 0.6 * hash(id, 150 + q, seed)), 6 + hash(id, 160 + q, seed) * 4);
            }
            continue;
          }
          const r = hash(id, 40, seed);
          const uIn = side * (ROAD_HALF + SIDEWALK);
          const ym = (y0 + y1) / 2;
          if (frontHit) {
            // 갈림길 도로 자리 — 건물 없음
          } else if (frontKind === "shop") {
            // 상가: 1~3층 평지붕, 1층 유리창 + 간판 띠, 위층 창문, 옥상 실외기
            const depth = 34 + r * 26;
            const uOut = uIn + side * depth;
            const floors = 1 + Math.floor(hash(id, 41, seed) * 3);
            const zt = floors * 13 + 2;
            const roof = SHOP_ROOF[Math.floor(r * SHOP_ROOF.length)];
            const sign = SIGN[Math.floor(hash(id, 50, seed) * SIGN.length)];
            const wall = SHOP_WALL[Math.floor(hash(id, 42, seed) * SHOP_WALL.length)];
            castShadow([
              [uIn, y0, zt],
              [uOut, y0, zt],
              [uOut, y1, zt],
              [uIn, y1, zt],
            ]);
            addSolid((uIn + uOut) / 2, ym, () => {
              const det = fine(uIn, ym);
              const upper: [number, number][] = [];
              for (let f = 1; f < floors; f++) upper.push([13 * f + 3.5, 13 * f + 9.5]);
              const um = uIn + side * depth * 0.55;
              drawBox(
                uIn,
                uOut,
                y0,
                y1,
                0,
                zt,
                wall,
                roof,
                (w) => {
                  if (w.kind === "in") {
                    if (det) panes(w, [[1.2, 8.8]], Math.max(2, Math.round(w.len / 9)), GLASS, 0.04, 0.05);
                    band(w, 9.3, 12.5, sign);
                    if (det) band(w, 10.3, 11.5, "rgba(255,255,255,0.78)", 0.3, 0.7);
                    if (det && upper.length) panes(w, upper, Math.max(2, Math.floor(w.len / 9)), WINDOW);
                  } else if (w.kind === "near") {
                    band(w, 9.3, 12.5, sign, 0, 0.12);
                    if (det && upper.length) panes(w, upper, Math.max(1, Math.floor(w.len / 12)), WINDOW);
                  }
                },
                () => drawBox(um, um + side * depth * 0.2, y0 + (y1 - y0) * 0.25, y0 + (y1 - y0) * 0.5, zt, zt + 3.5, "#9aa0a6", "#b7bcc1"),
              );
            });
          } else {
            // 주택: 마당·담장 + 2층 박공지붕 집
            const setback = 8 + r * 8;
            const depth = 30 + r * 14;
            const hIn = uIn + side * setback;
            const hOut = hIn + side * depth;
            const lotOut = hOut + side * 10;
            const roof = HOUSE_ROOF[Math.floor(hash(id, 60, seed) * HOUSE_ROOF.length)];
            const wall = HOUSE_WALL[Math.floor(hash(id, 63, seed) * HOUSE_WALL.length)];
            const zw = 11 + hash(id, 61, seed) * 4;
            const zr = zw + 6 + hash(id, 62, seed) * 3;
            const mid = (hIn + hOut) / 2;
            fillQuad(uIn, lotOut, y0, y1, "#9caf7a");
            ctx.strokeStyle = "#ddd8cb";
            ctx.lineWidth = Math.max(1, 1.5 * k);
            ctx.stroke();
            castShadow([
              [hIn, y0 + 4, zw],
              [hOut, y0 + 4, zw],
              [hOut, y1 - 4, zw],
              [hIn, y1 - 4, zw],
              [mid, y0 + 4, zr],
              [mid, y1 - 4, zr],
            ]);
            addSolid(mid, ym, () => {
              const det = fine(hIn, ym);
              drawGable(hIn, hOut, y0 + 4, y1 - 4, zw, zr, wall, roof[1], (w) => {
                if (!det) return;
                if (w.kind === "in") {
                  panes(w, [[3.5, 7.5]], 2, WINDOW, 0.12, 0.25);
                  band(w, 0, 6.5, "#6b4f3a", 0.46, 0.56);
                } else if (w.kind === "near") panes(w, [[3.5, 7.5]], 1, WINDOW, 0.25, 0.25);
              });
            });
            if (r > 0.4) tree3(uIn + side * (setback * 0.45), y0 + (y1 - y0) * (0.3 + 0.4 * hash(id, 70, seed)), 5 + r * 3);
          }
          // 뒷줄: 주택 / 빌라 / 주차장 / 공원
          const backIn = side * (ROAD_HALF + SIDEWALK + 72);
          const backKind = hash(id, 80, seed);
          const bOut = backIn + side * (48 + hash(id, 81, seed) * 30);
          if (backHit) {
            // 갈림길 도로 자리 — 건물 없음
          } else if (backKind < 0.45) {
            const roof = HOUSE_ROOF[Math.floor(hash(id, 82, seed) * HOUSE_ROOF.length)];
            const wall = HOUSE_WALL[Math.floor(hash(id, 84, seed) * HOUSE_WALL.length)];
            const hIn = backIn + side * 6;
            const zw = 10 + hash(id, 85, seed) * 4;
            const zr = zw + 6 + hash(id, 86, seed) * 3;
            const mid = (hIn + bOut) / 2;
            fillQuad(backIn, bOut + side * 8, y0, y1, "#a3b384");
            castShadow([
              [hIn, y0 + 4, zw],
              [bOut, y0 + 4, zw],
              [bOut, y1 - 4, zw],
              [hIn, y1 - 4, zw],
              [mid, y0 + 4, zr],
              [mid, y1 - 4, zr],
            ]);
            addSolid(mid, ym, () => {
              const det = fine(hIn, ym);
              drawGable(hIn, bOut, y0 + 4, y1 - 4, zw, zr, wall, roof[1], (w) => {
                if (det && (w.kind === "in" || w.kind === "near")) panes(w, [[3.5, 7.5]], w.kind === "in" ? 2 : 1, WINDOW, 0.15, 0.25);
              });
            });
          } else if (backKind < 0.75) {
            // 빌라: 3~4층, 1층 필로티(주차), 층마다 창문·베란다, 옥상 계단실
            const floors = 3 + (hash(id, 87, seed) < 0.4 ? 1 : 0);
            const zt = floors * 11 + 2;
            const wall = VILLA_WALL[Math.floor(hash(id, 88, seed) * VILLA_WALL.length)];
            const roof = VILLA_ROOF[Math.floor(hash(id, 83, seed) * VILLA_ROOF.length)];
            castShadow([
              [backIn, y0, zt],
              [bOut, y0, zt],
              [bOut, y1, zt],
              [backIn, y1, zt],
            ]);
            addSolid((backIn + bOut) / 2, ym, () => {
              const det = fine(backIn, ym);
              const rows: [number, number][] = [];
              for (let f = 1; f < floors; f++) rows.push([11 * f + 3, 11 * f + 8.5]);
              const um = (backIn + bOut) / 2;
              drawBox(
                backIn,
                bOut,
                y0,
                y1,
                0,
                zt,
                wall,
                roof,
                (w) => {
                  if (w.kind !== "in" && w.kind !== "near") return;
                  if (w.kind === "in") band(w, 0, 8.5, "#4a4f57", 0.06, 0.94);
                  if (!det) return;
                  panes(w, rows, Math.max(2, Math.floor(w.len / 11)), WINDOW, 0.08, 0.18);
                  if (w.kind === "in") for (const [z0] of rows) band(w, z0 - 1.6, z0 - 0.4, "rgba(255,255,255,0.35)", 0.04, 0.96);
                },
                () => drawBox(um, um + side * 10, y0 + (y1 - y0) * 0.3, y0 + (y1 - y0) * 0.55, zt, zt + 7, wall, "#7f8b98"),
              );
            });
          } else if (backKind < 0.9) {
            fillQuad(backIn, bOut, y0, y1, pat);
            for (let py = y0 + 3; py < y1 - 10; py += 12) {
              if (hash(Math.round(py), id, seed) < 0.35) continue;
              v.car(ctx, (backIn + bOut) / 2, py + 5, Math.PI / 2, CAR[Math.floor(hash(Math.round(py), id + 1, seed) * CAR.length)]);
            }
          } else {
            fillQuad(backIn, bOut, y0, y1, "#8fae6c");
            tree3((backIn + bOut) / 2, ym, 9);
          }
        }
      }
    }

    // 2.5) 갈림길 도로(우회로·막힌 기존 길) — 큰길보다 먼저 칠해 겹치는 입구는 큰길이 덮는다
    for (const b of branches) {
      const n = b.x.length;
      const vis = b.x.map((x, i) => {
        const f = v.groundW(x, b.y[i])[1];
        return f > v.fNear && f < v.fFar;
      });
      const off = (i: number, u: number): P => v.Mw(b.x[i] + u * Math.cos(b.a[i]), b.y[i] - u * Math.sin(b.a[i]));
      /** 화면에 들어오는 연속 구간마다 */
      const runs = (f: (i0: number, i1: number) => void) => {
        let i = 0;
        while (i < n) {
          if (!vis[i]) {
            i++;
            continue;
          }
          let j = i;
          while (j + 1 < n && vis[j + 1]) j++;
          if (j > i) f(i, j);
          i = j + 1;
        }
      };
      const brStrip = (half: number, fill: string | CanvasPattern) =>
        runs((i0, i1) => {
          ctx.beginPath();
          for (let i = i0; i <= i1; i++) {
            const [x, yy] = off(i, -half);
            if (i === i0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          for (let i = i1; i >= i0; i--) {
            const [x, yy] = off(i, half);
            ctx.lineTo(x, yy);
          }
          ctx.closePath();
          ctx.fillStyle = fill;
          ctx.fill();
        });
      const brLine = (u: number, color: string, w: number) =>
        runs((i0, i1) => {
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, w * k);
          ctx.beginPath();
          for (let i = i0; i <= i1; i++) {
            const [x, yy] = off(i, u);
            if (i === i0) ctx.moveTo(x, yy);
            else ctx.lineTo(x, yy);
          }
          ctx.stroke();
        });
      brStrip(ROAD_HALF + SIDEWALK, "#d9d5ca");
      brStrip(ROAD_HALF + 1.5, "#ecebe6");
      brStrip(ROAD_HALF, pat);
      brLine(-1.3, "#f2c230", 0.9);
      brLine(1.3, "#f2c230", 0.9);
      brLine(-ROAD_HALF + 1.4, "rgba(255,255,255,0.85)", 0.7);
      brLine(ROAD_HALF - 1.4, "rgba(255,255,255,0.85)", 0.7);
    }

    // 3) 큰길: 경계석(보도) → 아스팔트 → 차선
    const strip = (half: number, fill: string | CanvasPattern) => {
      ctx.beginPath();
      for (let y = yLo; y <= yHi; y += 6) {
        const [x, yy] = M(-half, y);
        if (y === yLo) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      for (let y = yHi; y >= yLo; y -= 6) {
        const [x, yy] = M(half, y);
        ctx.lineTo(x, yy);
      }
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    strip(ROAD_HALF + SIDEWALK, "#d9d5ca");
    strip(ROAD_HALF + 1.5, "#ecebe6");
    strip(ROAD_HALF, pat);
    const line = (u: number, color: string, w: number, dash?: number[]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(1, w * k);
      ctx.setLineDash(dash ? dash.map((d) => d * k) : []);
      ctx.beginPath();
      for (let y = yLo; y <= yHi; y += 6) {
        const [x, yy] = M(u, y);
        if (y === yLo) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    };
    line(-1.3, "#f2c230", 0.9);
    line(1.3, "#f2c230", 0.9);
    line(-ROAD_HALF + 1.4, "rgba(255,255,255,0.85)", 0.7);
    line(ROAD_HALF - 1.4, "rgba(255,255,255,0.85)", 0.7);

    // 골목 입구 횡단보도 + 정지선
    for (let i = i0; i <= i1; i++) {
      for (const a of alleysOf(i)) {
        if (hash(i, 90 + a.side, seed) < 0.35) continue;
        const cy = a.wy - a.w / 2 - 9;
        for (let u = -ROAD_HALF + 3; u < ROAD_HALF - 3; u += 4.6) fillQuad(u, u + 2.6, cy - 4, cy + 4, "rgba(255,255,255,0.82)");
      }
    }

    // 건물·나무 그림자 — 한 경로로 모아 칠해 겹친 곳도 같은 진하기 (왼쪽 건물 그림자는 보도·차도에 걸친다)
    ctx.beginPath();
    for (const poly of shadowPolys) {
      for (let j = 0; j < poly.length; j++) {
        const [x, yy] = M(poly[j][0], poly[j][1]);
        if (j === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.closePath();
    }
    ctx.fillStyle = "rgba(18,22,28,0.28)";
    ctx.fill();

    // 4) 길가 주차 차량
    for (let i = i0; i <= i1; i++) {
      const alleys = alleysOf(i);
      for (const side of [-1, 1] as const) {
        for (let j = 0; j < 5; j++) {
          if (hash(i * 7 + j, side + 95, seed) > 0.3) continue;
          const wy = i * BLOCK + 14 + j * 32;
          if (inAlley(side, wy - 12, wy + 12, alleys)) continue;
          if (onBranch(side, ROAD_HALF - 10, ROAD_HALF, wy - 12, wy + 12)) continue; // 갈림길 입구
          if (side > 0 && o.keepClearWy?.some((c) => Math.abs(c - wy) < 26)) continue;
          v.car(ctx, side * (ROAD_HALF - 4.6), wy, 0, CAR[Math.floor(hash(i * 7 + j, 96, seed) * CAR.length)], side < 0 ? Math.PI : 0, { plate: fakePlate(i * 14 + j * 2 + (side > 0 ? 1 : 0) + seed * 1000) });
        }
      }
    }

    // 5) 오가는 차량: 오른쪽 차로(드론과 같은 방향), 왼쪽 차로(반대 방향)
    const yieldAmt = o.yieldAmt ?? 0;
    for (const lane of [1, -1] as const) {
      const vel = lane > 0 ? 8 : -12;
      const gap = 52;
      const bLo = yLo - vel * o.t;
      const bHi = yHi - vel * o.t;
      for (let q = Math.floor(bLo / gap); q <= Math.ceil(bHi / gap); q++) {
        if (hash(q, lane + 100, seed) > 0.45) continue;
        const wy = q * gap + hash(q, lane + 101, seed) * 18 + vel * o.t;
        if (lane > 0 && o.blockWy !== undefined && wy > o.blockWy - 70 && wy < o.blockWy + 40) continue;
        const u = lane > 0 ? LANE / 2 + yieldAmt * 5 : -LANE / 2;
        v.car(ctx, u, wy, lane > 0 ? yieldAmt * 0.06 : 0, CAR[Math.floor(hash(q, lane + 102, seed) * CAR.length)], lane > 0 ? 0 : Math.PI, { plate: fakePlate(q * 3 + lane + seed * 500) });
      }
    }

    // 6) 입체 건물·나무 — 먼 것부터 (화가 알고리즘). 건물은 길 바깥으로 기울어 보여 길 위 차는 가리지 않고,
    //    굽은 길 저 앞쪽만 가까운 건물 뒤로 숨는다
    solids.sort((a, b) => b.d - a.d);
    for (const s of solids) s.f();
    ctx.restore();
    return v;
  }

  return { draw, frame, view: makeView, world, setPath, setBranches };
}
