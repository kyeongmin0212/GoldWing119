import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "G-J 골든타임 윙 — 전남·광주 광역 드론 관제",
  description: "AI 에이전트 기반 긴급출동 선행 드론 관제 및 불법주정차 원클릭 신고 시뮬레이터 (해커톤 시연용)",
};

export const viewport: Viewport = { themeColor: "#070b12", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className="dark">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
