// 공개 서버에 올릴 때 쓰는 간단한 접속 비밀번호 (HTTP Basic 인증).
// BASIC_AUTH_USER·BASIC_AUTH_PASS 환경 변수를 둘 다 넣으면 켜지고, 없으면 꺼진다(로컬 시연).
// 도메인을 아는 누구나 IBM 에이전트 호출(/api/agent)과 화면 중계(/api/sync)를 쓰지 못하게 막는다.

import { NextResponse, type NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;
  if (!user || !pass) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const [u, ...rest] = atob(header.slice(6)).split(":");
      if (u === user && rest.join(":") === pass) return NextResponse.next();
    } catch {
      /* 잘못된 헤더 */
    }
  }
  return new NextResponse("인증이 필요합니다", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="G-J Golden Time Wing", charset="UTF-8"' } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
