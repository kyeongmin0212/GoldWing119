// watsonx Orchestrate REST 클라이언트 (서버 전용)
// 수업 자료 starter/llm.py · 예제11 app.py 의 ask_agent 패턴을 TypeScript 로 옮김.
// API 키·인스턴스 URL 은 절대 브라우저로 보내지 않고, 오류 메시지에도 넣지 않는다.
import "server-only";

type Tok = { token: string; exp: number };
let tokCache: Tok | null = null;
let agentIdCache: string | null = null;

export function wxoConfigured(): boolean {
  if (process.env.MOCK === "1") return false;
  return Boolean(
    process.env.WXO_ENDPOINT_URL?.trim() &&
      process.env.WXO_API_KEY?.trim() &&
      (process.env.WXO_AGENT_ID?.trim() || process.env.WXO_AGENT_NAME?.trim()),
  );
}

async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } finally {
    clearTimeout(t);
  }
}

async function iamToken(): Promise<string> {
  const now = Date.now() / 1000;
  if (tokCache && now < tokCache.exp - 60) return tokCache.token;
  const body = new URLSearchParams({
    grant_type: "urn:ibm:params:oauth:grant-type:apikey",
    apikey: process.env.WXO_API_KEY!.trim(),
  });
  const r = await fetchWithTimeout(
    "https://iam.cloud.ibm.com/identity/token",
    { method: "POST", body, headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    30_000,
  );
  if (!r.ok) throw new Error(`IAM 토큰 발급 실패(${r.status}) — WXO_API_KEY 확인`);
  const d = (await r.json()) as { access_token: string; expiration?: number; expires_in?: number };
  tokCache = { token: d.access_token, exp: d.expiration ?? now + (d.expires_in ?? 3600) };
  return tokCache.token;
}

async function agentId(base: string, token: string): Promise<string> {
  const fixed = process.env.WXO_AGENT_ID?.trim();
  if (fixed) return fixed;
  if (agentIdCache) return agentIdCache;
  const r = await fetchWithTimeout(`${base}/v1/orchestrate/agents`, { headers: { Authorization: `Bearer ${token}` } }, 30_000);
  if (!r.ok) throw new Error(`에이전트 목록 조회 실패(${r.status})`);
  const data = (await r.json()) as unknown;
  let items: { id: string; name: string }[] = [];
  if (Array.isArray(data)) items = data;
  else if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    items = (o.assistants ?? o.agents ?? []) as { id: string; name: string }[];
  }
  const name = process.env.WXO_AGENT_NAME!.trim();
  const hit = items.find((a) => a.name === name);
  if (!hit) throw new Error("WXO_AGENT_NAME 에 해당하는 에이전트를 찾지 못함");
  agentIdCache = hit.id;
  return hit.id;
}

/**
 * 연결 확인: IAM 토큰 + 에이전트 목록을 실제로 요청해 대상 에이전트가 있는지 본다 (대화는 보내지 않음).
 * 토큰은 캐시돼도 목록 요청은 매번 네트워크로 나가므로 인터넷 끊김·키 만료·에이전트 삭제를 잡는다.
 */
export async function pingAgent(timeoutMs = 10_000): Promise<void> {
  const base = process.env.WXO_ENDPOINT_URL!.trim().replace(/\/+$/, "");
  const token = await iamToken();
  const r = await fetchWithTimeout(`${base}/v1/orchestrate/agents`, { headers: { Authorization: `Bearer ${token}` } }, timeoutMs);
  if (r.status === 401 || r.status === 403) {
    tokCache = null;
    throw new Error(`인증 오류(${r.status})`);
  }
  if (!r.ok) throw new Error(`에이전트 목록 조회 실패(${r.status})`);
  const data = (await r.json()) as unknown;
  const items: { id: string; name: string }[] = Array.isArray(data)
    ? data
    : (((data as Record<string, unknown>)?.assistants ?? (data as Record<string, unknown>)?.agents ?? []) as { id: string; name: string }[]);
  const fixed = process.env.WXO_AGENT_ID?.trim();
  const name = process.env.WXO_AGENT_NAME?.trim();
  const hit = items.find((a) => (fixed ? a.id === fixed : a.name === name));
  if (!hit) throw new Error("대상 에이전트를 찾지 못함");
  agentIdCache = hit.id;
}

export async function askAgent(
  text: string,
  threadId?: string,
  timeoutMs = 60_000,
): Promise<{ text: string; threadId?: string }> {
  const base = process.env.WXO_ENDPOINT_URL!.trim().replace(/\/+$/, "");
  const token = await iamToken();
  const id = await agentId(base, token);
  const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  if (threadId) headers["X-IBM-THREAD-ID"] = threadId;
  const r = await fetchWithTimeout(
    `${base}/v1/orchestrate/${id}/chat/completions`,
    { method: "POST", headers, body: JSON.stringify({ messages: [{ role: "user", content: text }], stream: false }) },
    timeoutMs,
  );
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new Error(`인증 오류(${r.status})`);
    if (r.status === 404) throw new Error("에이전트 ID/URL 확인 필요(404)");
    throw new Error(`에이전트 호출 실패(${r.status})`);
  }
  const d = (await r.json()) as { choices?: { message?: { content?: unknown } }[]; thread_id?: string };
  const answer = contentText(d.choices?.[0]?.message?.content) || JSON.stringify(d).slice(0, 500);
  return { text: answer, threadId: d.thread_id ?? threadId };
}

/** message.content 가 문자열이 아니라 조각 리스트([{type:"text", text}])로 올 수 있어 텍스트만 이어 붙인다 */
export function contentText(c: unknown): string {
  if (typeof c === "string") return c;
  if (Array.isArray(c))
    return c
      .map((p) => (typeof p === "string" ? p : p && typeof p === "object" ? String((p as { text?: unknown }).text ?? "") : ""))
      .join("");
  return "";
}

/** 답에서 첫 '{' ~ 마지막 '}' 를 JSON 으로 읽기 (starter/llm.py last_json 과 동일) */
export function lastJson(raw: string): Record<string, unknown> | null {
  const s = raw.indexOf("{");
  const e = raw.lastIndexOf("}");
  if (s < 0 || e <= s) return null;
  try {
    return JSON.parse(raw.slice(s, e + 1));
  } catch {
    return null;
  }
}

/** UUID·서비스ID·URL 마스킹 (예제11 mask 패턴) */
export function mask(s: string): string {
  return s
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "****")
    .replace(/iam-ServiceId-[\w-]+/g, "iam-ServiceId-****")
    .replace(/https?:\/\/\S+/g, "[url]");
}
