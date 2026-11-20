// 혼잡 DB (시연용 가상 데이터)
// 실제 서비스에서는 국가교통정보센터 소통정보(https://www.its.go.kr)와
// 안전신문고 불법주정차 신고 이력·지자체 단속 이력으로 채운다.
import type { Hotspot } from "../types/drone.ts";

const RUSH: [number, number][] = [
  [7, 9],
  [17, 20],
];

export const HOTSPOTS: Hotspot[] = [
  {
    id: "H-BU",
    name: "백운광장 교차로 상습정체",
    kind: "상습정체",
    position: { lat: 35.133, lng: 126.896 },
    activeHours: RUSH,
    source: "가상 (실서비스: 국가교통정보센터 소통정보)",
  },
  {
    id: "H-BS",
    name: "봉선동 이면도로 불법주정차 다발",
    kind: "불법주정차다발",
    position: { lat: 35.129, lng: 126.905 },
    source: "가상 (실서비스: 안전신문고 신고 이력)",
  },
  {
    id: "H-NG",
    name: "나주-광주 경계 국도1호선 진입 병목",
    kind: "상습정체",
    position: { lat: 35.07, lng: 126.84 },
    activeHours: RUSH,
    source: "가상 (실서비스: 국가교통정보센터 소통정보)",
  },
  {
    id: "H-HC",
    name: "효천지구 이면도로 불법주정차 다발",
    kind: "불법주정차다발",
    position: { lat: 35.092, lng: 126.865 },
    source: "가상 (실서비스: 안전신문고 신고 이력)",
  },
];

export function isActive(h: Hotspot, hour: number): boolean {
  if (!h.activeHours) return true;
  return h.activeHours.some(([a, b]) => hour >= a && hour < b);
}
