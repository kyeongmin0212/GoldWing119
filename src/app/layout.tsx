import type { Metadata, Viewport } from "next";
import "./globals.css";

// 글꼴은 설치된 시스템 한글 글꼴을 씀 (외부 글꼴 내려받기 없음 — 오프라인 시연 가능)

export const metadata: Metadata = {
  title: "G-J 골든타임 윙 — 긴급출동 선행 드론 관제",
  description: "119 상황실 콘솔과 소방차 태블릿 화면 (해커톤 시연용 시뮬레이션)",
};

export const viewport: Viewport = { themeColor: "#1f3a68", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
