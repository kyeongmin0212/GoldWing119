import type { NextConfig } from "next";

// IBM 연동은 서버 라우트(/api/agent)에서만 하므로 브라우저가 외부 IBM 스크립트를 불러올 필요가 없다.
// 외부에서 받는 것은 OpenStreetMap 지도 타일 이미지뿐이다.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://tile.openstreetmap.org https://*.tile.openstreetmap.org",
  "connect-src 'self'",
  "font-src 'self' data:",
  "frame-ancestors 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // Docker 배포용: 실행에 필요한 파일만 .next/standalone 에 모은다
  output: "standalone",
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "X-Content-Type-Options", value: "nosniff" },
          // OpenStreetMap 타일 이용 정책상 Referer 가 필요 — 주소 전체가 아니라 출처(origin)만 보냄
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

export default nextConfig;
