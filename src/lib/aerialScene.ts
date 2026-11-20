// 드론 가상 영상용 항공 장면 — 위에서 내려다본 동네 길 (실제 영상·지도 아님, 코드로 그린 가상 장면)
// 굽은 2차선 도로, 옆으로 갈라지는 골목, 길가 상가(간판)와 주택(지붕·마당·담장), 뒷줄 주택·빌라·주차장·공원, 나무, 주차 차량, 오가는 차량.
// 같은 seed 면 언제나 같은 동네가 나온다. 세계 좌표 단위: 차로 폭 15 (약 3.5m).
// 모든 것은 "도로 좌표"(u = 도로 중심에서 옆으로, wy = 도로를 따라 앞으로)로 배치해 굽은 길을 따라 휘어진다.
// 카메라는 드론 진행 방향이 화면 위쪽이 되도록 돌아가고, 바로 아래가 아니라 앞으로 기울여(원근) 내려다본다.
// 정찰 때는 낮게(약 18m) 날아 가까운 차의 번호판이 보이고, 순항 때는 높이 올라가 거의 바로 아래를 본다.

export const LANE = 15;
export const ROAD_HALF = LANE * 2;
const SIDEWALK = 10;
const BLOCK = 170;

type Ctx = CanvasRenderingContext2D;
type P = [number, number];

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
  len?: number;
  wid?: number;
  police?: boolean;
  truck?: boolean;
  blink?: boolean;
  /** 진행 방향 쪽 원근 압축 (1 = 압축 없음) */
  sy?: number;
  /** 번호판 글자 — 가까워서 크게 보이면 앞·뒤에 그린다 */
  plate?: string;
}

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
  /** 막힌 지점(사고) — 이 근처 같은 방향 차로에는 달리는 차를 두지 않는다 */
  blockWy?: number;
  /** 진로방해 차량 자리 — 이 근처 오른쪽 길가에는 다른 주차 차량을 두지 않는다 */
  keepClearWy?: number[];
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
const CAR = ["#f2f2f0", "#c7cbd0", "#2b2d31", "#7b8088", "#b3262b", "#2f4f8a", "#d8d2c4", "#f2f2f0", "#c7cbd0", "#e9e9e6"];

export function createAerialScene(seed = 1) {
  const roadX = (wy: number) => 150 * Math.sin(wy / 330 + seed) + 55 * Math.sin(wy / 140 + seed * 2.1);
  const roadDx = (wy: number) => (150 / 330) * Math.cos(wy / 330 + seed) + (55 / 140) * Math.cos(wy / 140 + seed * 2.1);
  const frame = (wy: number): RoadFrame => ({ cx: roadX(wy), angle: Math.atan(roadDx(wy)) });
  /** 도로 좌표 → 세계 좌표 (중심선에서 법선 방향으로 u 만큼) */
  const world = (u: number, wy: number): P => {
    const dx = roadDx(wy);
    const n = Math.sqrt(1 + dx * dx);
    return [roadX(wy) + u / n, wy - (u * dx) / n];
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
      g.fillStyle = "rgba(40,42,46,0.22)";
      g.fillRect(20, 30, 46, 22);
      g.fillRect(100, 110, 30, 40);
    }
    if (!asphalt) asphalt = ctx.createPattern(asphaltSrc, "repeat");
    return asphalt ?? "#5f6368";
  }

  /**
   * 기울인 카메라(핀홀) 투영. zoom 1 = 정찰(낮게, 앞으로 약 46° 기울임), 0.55 = 순항(높게, 거의 바로 아래).
   * 화면 가운데(cy)에 드론 위치(s)가 오고, 화면 위쪽일수록 앞쪽 먼 곳이 작게 보인다.
   */
  function makeView(W: number, H: number, s: number, zoom: number): AerialView {
    const lowness = Math.max(0, Math.min(1, (zoom - 0.55) / 0.45)); // 0 순항 ~ 1 정찰
    const kc = (W / 340) * zoom * 2.3; // 화면 가운데 배율
    const theta = 1.18 - 0.44 * lowness; // 광축이 수평에서 내려간 각 (라디안): 순항 약 68°, 정찰 약 42°
    const F = 0.7 * W; // 초점 거리(픽셀)
    const h = (F * Math.sin(theta)) / kc; // 카메라 높이(세계 단위)
    const cosT = Math.cos(theta);
    const sinT = Math.sin(theta);
    const lookAhead = h / Math.tan(theta); // 바로 아래 지점에서 화면 가운데 지점까지
    const cx = W / 2;
    const cy = H * 0.66; // 화면 가운데보다 조금 아래 — 앞쪽을 더 넓게 본다
    const camX = roadX(s + 25);
    const camAngle = 0.75 * Math.atan(roadDx(s + 30)) + 0.25 * Math.atan(roadDx(s + 90));
    const c = Math.cos(-camAngle);
    const sn = Math.sin(-camAngle);
    /** 도로 좌표 → (옆 l, 바로 아래 지점에서 앞으로 f) */
    const ground = (u: number, wy: number): P => {
      const [wx, wyy] = world(u, wy);
      const x = wx - camX;
      const y = -(wyy - s);
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
    const kAt = (u: number, wy: number) => F / zcOf(ground(u, wy)[1]);
    // 화면 위·아래 끝에 해당하는 앞 거리 → 그릴 범위
    const fAtRow = (py: number) => {
      const r = (py - cy) / F;
      return (h * (cosT - r * sinT)) / (sinT + r * cosT);
    };
    const rTop = (0 - cy) / F;
    const fTop = sinT + rTop * cosT > 0.02 ? fAtRow(0) : h * 12;
    const fBot = fAtRow(H);
    const wyMin = s + (fBot - lookAhead) - 60;
    const wyMax = s + (Math.min(fTop, h * 12) - lookAhead) + 60;
    const car: AerialView["car"] = (ctx, u, wy, extra, color, flip = 0, opt = {}) => {
      const [x0, y0] = M(u, wy);
      const [x1, y1] = M(u + 2 * Math.sin(extra), wy + 2 * Math.cos(extra));
      const ang = Math.atan2(x1 - x0, -(y1 - y0));
      const kk = kAt(u, wy);
      const sy = Math.max(0.35, Math.min(1, Math.hypot(x1 - x0, y1 - y0) / (2 * kk)));
      drawCar(ctx, x0, y0, ang, kk, color, flip, { ...opt, sy });
    };
    return {
      k: kc,
      W,
      H,
      camAngle,
      M,
      screen: M,
      kAt,
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
    const v = makeView(W, H, o.s, o.zoom);
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
    // 그림자: 해가 왼쪽 위 → 화면 오른쪽 아래로 (회전된 좌표에서 고정 오프셋이면 충분)
    const shadowQuad = (u0: number, u1: number, y0: number, y1: number, d: number) => {
      const kk = v.kAt((u0 + u1) / 2, (y0 + y1) / 2);
      ctx.save();
      ctx.translate(d * kk * 0.8, d * kk * 0.6);
      fillQuad(u0, u1, y0, y1, "rgba(18,22,28,0.3)");
      ctx.restore();
    };

    const pat = asphaltPattern(ctx);
    const i0 = Math.floor(yLo / BLOCK);
    const i1 = Math.ceil(yHi / BLOCK);
    const inAlley = (side: number, y0: number, y1: number, list: { side: number; wy: number; w: number }[]) =>
      list.some((a) => a.side === side && y1 > a.wy - a.w / 2 - 3 && y0 < a.wy + a.w / 2 + 3);

    // 1) 골목 (아스팔트 띠)
    for (let i = i0; i <= i1; i++) {
      for (const a of alleysOf(i)) {
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

    // 2) 건물·마당·주차장 — 앞줄(도로변)과 뒷줄
    const shadows: (() => void)[] = [];
    const bodies: (() => void)[] = [];
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
          const r = hash(id, 40, seed);
          const uIn = side * (ROAD_HALF + SIDEWALK);
          if (frontKind === "shop") {
            const depth = 34 + r * 26;
            const uOut = uIn + side * depth;
            const roof = SHOP_ROOF[Math.floor(r * SHOP_ROOF.length)];
            const sign = SIGN[Math.floor(hash(id, 50, seed) * SIGN.length)];
            shadows.push(() => shadowQuad(uIn, uOut, y0, y1, 8));
            bodies.push(() => {
              fillQuad(uIn, uOut, y0, y1, roof);
              ctx.strokeStyle = "rgba(0,0,0,0.16)";
              ctx.lineWidth = 1;
              ctx.stroke();
              // 옥상 실외기·물탱크
              const um = uIn + side * depth * 0.55;
              fillQuad(um, um + side * depth * 0.2, y0 + (y1 - y0) * 0.25, y0 + (y1 - y0) * 0.5, "rgba(125,130,136,0.8)");
              // 도로 쪽 간판·줄무늬 차양
              fillQuad(uIn, uIn + side * 4.5, y0 + 1, y1 - 1, sign);
              for (let st = y0 + 2; st < y1 - 2; st += 5) fillQuad(uIn, uIn + side * 4.5, st, st + 2, "rgba(255,255,255,0.5)");
            });
          } else {
            const setback = 8 + r * 8;
            const depth = 30 + r * 14;
            const hIn = uIn + side * setback;
            const hOut = hIn + side * depth;
            const lotOut = hOut + side * 10;
            const roof = HOUSE_ROOF[Math.floor(hash(id, 60, seed) * HOUSE_ROOF.length)];
            shadows.push(() => {
              fillQuad(uIn, lotOut, y0, y1, "#9caf7a");
              ctx.strokeStyle = "#ddd8cb";
              ctx.lineWidth = Math.max(1, 1.5 * k);
              ctx.stroke();
              shadowQuad(hIn, hOut, y0 + 4, y1 - 4, 6);
            });
            bodies.push(() => {
              const mid = (hIn + hOut) / 2;
              fillQuad(hIn, mid, y0 + 4, y1 - 4, roof[0]);
              fillQuad(mid, hOut, y0 + 4, y1 - 4, roof[1]);
              quad(hIn, hOut, y0 + 4, y1 - 4);
              ctx.strokeStyle = "rgba(0,0,0,0.25)";
              ctx.lineWidth = Math.max(1, 1.1 * k);
              ctx.stroke();
              if (r > 0.4) tree(ctx, M, v.kAt, uIn + side * (setback * 0.45), y0 + (y1 - y0) * (0.3 + 0.4 * hash(id, 70, seed)), 5 + r * 3);
            });
          }
          // 뒷줄: 주택 / 빌라 / 주차장 / 공원
          const backIn = side * (ROAD_HALF + SIDEWALK + 72);
          const backKind = hash(id, 80, seed);
          const bOut = backIn + side * (48 + hash(id, 81, seed) * 30);
          if (backKind < 0.45) {
            const roof = HOUSE_ROOF[Math.floor(hash(id, 82, seed) * HOUSE_ROOF.length)];
            shadows.push(() => {
              fillQuad(backIn, bOut + side * 8, y0, y1, "#a3b384");
              shadowQuad(backIn + side * 6, bOut, y0 + 4, y1 - 4, 6);
            });
            bodies.push(() => {
              const mid = (backIn + side * 6 + bOut) / 2;
              fillQuad(backIn + side * 6, mid, y0 + 4, y1 - 4, roof[0]);
              fillQuad(mid, bOut, y0 + 4, y1 - 4, roof[1]);
            });
          } else if (backKind < 0.75) {
            shadows.push(() => shadowQuad(backIn, bOut, y0, y1, 12));
            bodies.push(() => {
              fillQuad(backIn, bOut, y0, y1, VILLA_ROOF[Math.floor(hash(id, 83, seed) * VILLA_ROOF.length)]);
              ctx.strokeStyle = "rgba(0,0,0,0.18)";
              ctx.lineWidth = 1;
              ctx.stroke();
              const um = (backIn + bOut) / 2;
              fillQuad(um, um + side * 8, y0 + (y1 - y0) * 0.3, y0 + (y1 - y0) * 0.55, "#7f8b98");
            });
          } else if (backKind < 0.9) {
            bodies.push(() => {
              fillQuad(backIn, bOut, y0, y1, pat);
              for (let py = y0 + 3; py < y1 - 10; py += 12) {
                if (hash(Math.round(py), id, seed) < 0.35) continue;
                v.car(ctx, (backIn + bOut) / 2, py + 5, Math.PI / 2, CAR[Math.floor(hash(Math.round(py), id + 1, seed) * CAR.length)]);
              }
            });
          } else {
            bodies.push(() => {
              fillQuad(backIn, bOut, y0, y1, "#8fae6c");
              tree(ctx, M, v.kAt, (backIn + bOut) / 2, (y0 + y1) / 2, 9);
            });
          }
        }
      }
    }
    shadows.forEach((f) => f());
    bodies.forEach((f) => f());

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

    // 4) 길가 주차 차량
    for (let i = i0; i <= i1; i++) {
      const alleys = alleysOf(i);
      for (const side of [-1, 1] as const) {
        for (let j = 0; j < 5; j++) {
          if (hash(i * 7 + j, side + 95, seed) > 0.3) continue;
          const wy = i * BLOCK + 14 + j * 32;
          if (inAlley(side, wy - 12, wy + 12, alleys)) continue;
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
    ctx.restore();
    return v;
  }

  return { draw, frame, view: makeView, world };
}

function tree(ctx: Ctx, M: (u: number, wy: number) => P, kAt: (u: number, wy: number) => number, u: number, wy: number, r: number): void {
  const [x, y] = M(u, wy);
  const k = kAt(u, wy);
  const tr = r * k;
  ctx.fillStyle = "rgba(20,30,20,0.3)";
  ctx.beginPath();
  ctx.arc(x + 3.5 * k, y + 4.5 * k, tr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#4b7637";
  ctx.beginPath();
  ctx.arc(x, y, tr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.13)";
  ctx.beginPath();
  ctx.arc(x - tr * 0.3, y - tr * 0.3, tr * 0.45, 0, Math.PI * 2);
  ctx.fill();
}

/** 위에서 본 차량 — 그림자·차체·앞뒤 유리·지붕 반사. (x,y): 그리기 좌표 중심, k: 배율, 0도 = 위쪽을 향함 */
export function drawCar(ctx: Ctx, x: number, y: number, angle: number, k: number, color: string, flip = 0, opt: CarOpt = {}): void {
  const L = (opt.len ?? 19) * k;
  const Wd = (opt.wid ?? 9) * k;
  const sy = opt.sy ?? 1;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + flip);
  ctx.scale(1, sy);
  ctx.fillStyle = "rgba(10,14,20,0.34)";
  ctx.beginPath();
  ctx.roundRect(-Wd / 2 + 2.2 * k, -L / 2 + 2.8 * k, Wd, L, 2.5 * k);
  ctx.fill();
  if (opt.truck) {
    // 소방차: 빨간 차체 + 흰 띠 + 경광등
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-Wd / 2, -L / 2, Wd, L, 2 * k);
    ctx.fill();
    ctx.fillStyle = "rgba(25,35,50,0.88)";
    ctx.fillRect(-Wd / 2 + 1.2 * k, -L / 2 + 1.4 * k, Wd - 2.4 * k, L * 0.09);
    ctx.fillStyle = "#e9e7e2";
    ctx.fillRect(-Wd / 2 + 1.5 * k, -L / 2 + L * 0.2, Wd - 3 * k, L * 0.7);
    ctx.fillStyle = "#b8b4ac";
    for (let i = 0; i < 4; i++) ctx.fillRect(-Wd / 2 + 2.2 * k, -L / 2 + L * (0.26 + i * 0.16), Wd - 4.4 * k, 1 * k);
    ctx.fillStyle = opt.blink ? "#ef4444" : "#fca5a5";
    ctx.fillRect(-Wd / 2 + 1 * k, -L / 2 + L * 0.12, Wd / 2 - 1 * k, 2 * k);
    ctx.fillStyle = opt.blink ? "#fca5a5" : "#ef4444";
    ctx.fillRect(0, -L / 2 + L * 0.12, Wd / 2 - 1 * k, 2 * k);
    ctx.restore();
    return;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(-Wd / 2, -L / 2, Wd, L, 3 * k);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = Math.max(0.6, 0.5 * k);
  ctx.stroke();
  ctx.fillStyle = "rgba(25,35,50,0.88)";
  ctx.beginPath();
  ctx.roundRect(-Wd / 2 + 1.1 * k, -L / 2 + L * 0.2, Wd - 2.2 * k, L * 0.17, 1.2 * k);
  ctx.fill();
  ctx.beginPath();
  ctx.roundRect(-Wd / 2 + 1.3 * k, L / 2 - L * 0.27, Wd - 2.6 * k, L * 0.11, 1.2 * k);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  ctx.fillRect(-Wd / 2 + 1.5 * k, -L / 2 + L * 0.4, Wd * 0.35, L * 0.3);
  if (opt.police) {
    ctx.fillStyle = opt.blink ? "#ef4444" : "#7f1d1d";
    ctx.fillRect(-Wd / 2 + 1 * k, -L * 0.04, Wd / 2 - 1 * k, 2.4 * k);
    ctx.fillStyle = opt.blink ? "#1e3a8a" : "#3b82f6";
    ctx.fillRect(0, -L * 0.04, Wd / 2 - 1 * k, 2.4 * k);
  }
  // 카메라 쪽 차체 면(뒤를 보이면 뒷면, 마주 오면 앞면) — 기울인 카메라에서 보이는 만큼만, 그 면 가운데에 번호판
  const tiltVis = Math.sqrt(Math.max(0, 1 - sy * sy));
  const faceScreen = 1.45 * UNITS_PER_M * k * tiltVis * 0.9;
  if (faceScreen > 2) {
    const ang = angle + flip;
    const end = Math.cos(ang) >= 0 ? 1 : -1; // 화면 아래쪽(카메라 쪽) 끝
    const fh = faceScreen / sy;
    const y0 = end * (L / 2 - 0.6 * k);
    const y1 = end * (L / 2 + fh);
    const top = Math.min(y0, y1);
    const hgt = Math.abs(y1 - y0);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(-Wd / 2, top, Wd, hgt, Math.min(2 * k, hgt / 3));
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();
    // 범퍼 쪽 어두운 띠
    const bumper = end > 0 ? top + hgt * 0.72 : top;
    ctx.fillStyle = "rgba(20,24,30,0.45)";
    ctx.fillRect(-Wd / 2, bumper, Wd, hgt * 0.28);
    // 등: 뒷면이면 빨간 미등, 앞면이면 전조등 (차의 앞은 로컬 -y 쪽)
    const lampY = end > 0 ? top + hgt * 0.18 : top + hgt * 0.5;
    ctx.fillStyle = end > 0 ? "#dc2626" : "#fef3c7";
    ctx.fillRect(-Wd / 2 + 0.5 * k, lampY, Wd * 0.2, hgt * 0.22);
    ctx.fillRect(Wd / 2 - 0.5 * k - Wd * 0.2, lampY, Wd * 0.2, hgt * 0.22);
    // 번호판: 실제 위치(면 가운데, 범퍼 위). 영상에서 읽히도록 실물(차폭의 약 30%)보다 조금 크게
    const pw = Wd * 0.46;
    const ph = Math.min(hgt * 0.34, pw * 0.27);
    const pcy = end > 0 ? top + hgt * 0.56 : top + hgt * 0.44;
    ctx.fillStyle = "#f4f6f8";
    ctx.fillRect(-pw / 2, pcy - ph / 2, pw, ph);
    ctx.strokeStyle = "rgba(30,40,55,0.7)";
    ctx.lineWidth = Math.max(0.5, 0.15 * k);
    ctx.strokeRect(-pw / 2, pcy - ph / 2, pw, ph);
    if (opt.plate && ph * sy >= 4.5) {
      ctx.save();
      ctx.translate(0, pcy);
      if (end < 0) ctx.rotate(Math.PI);
      ctx.fillStyle = "#111827";
      ctx.font = `bold ${ph * 0.82}px "Malgun Gothic", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(opt.plate, 0, ph * 0.04, pw * 0.94);
      ctx.restore();
    }
  }
  ctx.restore();
}
