// 상황실 콘솔 → 소방차 태블릿 상태 중계 (서버 경유). 서로 다른 기기(노트북·태블릿)에서도 두 화면이 같이 움직이게 한다.
// - POST: 상황실 콘솔이 최신 상태(스냅샷)를 올림
// - GET : 소방차 화면이 Server-Sent Events 로 받음
// 서버 메모리에 최신 1개만 둔다(컨테이너 1개 기준). 같은 브라우저 안에서는 BroadcastChannel 도 함께 쓴다.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Hub = { last: string | null; lastAt: number; clients: Set<(data: string) => void> };
const g = globalThis as typeof globalThis & { __gjwSyncHub?: Hub };
const hub: Hub = (g.__gjwSyncHub ??= { last: null, lastAt: 0, clients: new Set() });

const MAX_BYTES = 300_000;
/** 이보다 오래된 상태는 새로 접속한 화면에 보내지 않는다 (상황실이 닫힌 뒤 옛 화면이 뜨지 않게) */
const STALE_MS = 5000;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BYTES) return new Response("too large", { status: 413 });
  try {
    const s = JSON.parse(text) as { mode?: unknown; status?: unknown };
    if (typeof s.mode !== "string" || typeof s.status !== "string") return new Response("bad snapshot", { status: 400 });
  } catch {
    return new Response("bad json", { status: 400 });
  }
  hub.last = text;
  hub.lastAt = Date.now();
  for (const send of hub.clients) send(text);
  return new Response(null, { status: 204 });
}

export async function GET(request: Request) {
  const enc = new TextEncoder();
  let send: ((data: string) => void) | null = null;
  let ping: ReturnType<typeof setInterval> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      send = (data) => {
        try {
          ctrl.enqueue(enc.encode(`data: ${data}\n\n`));
        } catch {
          /* 닫힌 연결 */
        }
      };
      hub.clients.add(send);
      if (hub.last && Date.now() - hub.lastAt < STALE_MS) send(hub.last);
      ping = setInterval(() => {
        try {
          ctrl.enqueue(enc.encode(": ping\n\n"));
        } catch {
          /* 닫힌 연결 */
        }
      }, 15000);
      request.signal.addEventListener("abort", () => {
        if (ping) clearInterval(ping);
        if (send) hub.clients.delete(send);
        try {
          ctrl.close();
        } catch {
          /* 이미 닫힘 */
        }
      });
    },
    cancel() {
      if (ping) clearInterval(ping);
      if (send) hub.clients.delete(send);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
