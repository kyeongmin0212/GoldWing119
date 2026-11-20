"use client";

// 출동 상황도 — 기본은 실제 지도(OpenStreetMap), 지도 서버에 연결되지 않으면 개략도(SVG)로 자동 대체

import { useState } from "react";
import LeafletMap from "@/components/LeafletMap";
import SchematicMap from "@/components/SchematicMap";
import type { SimView } from "@/lib/simView";

export default function TacticalMap({ sim, compact = false }: { sim: SimView; compact?: boolean }) {
  const [offline, setOffline] = useState(false);
  if (offline) {
    return (
      <div className="relative h-full w-full">
        <SchematicMap sim={sim} compact={compact} />
        <div className="absolute right-2 top-2 border border-slow bg-slow-soft px-2 py-0.5 text-[11px] text-slow">지도 서버 연결 안 됨 — 개략도 표시</div>
      </div>
    );
  }
  return <LeafletMap sim={sim} compact={compact} onFail={() => setOffline(true)} />;
}
