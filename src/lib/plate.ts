// 번호판 가리기 — 지도·드론 영상·소방차 화면에는 끝 두 자리를 가린다(촬영 고지 · 번호판 최소 보관).
// 통보 초안(상황실 관제요원 검토용)에는 전체 번호를 그대로 쓴다.
export function maskPlate(plate: string): string {
  return plate.replace(/(\d{2})\s*$/, "**");
}
