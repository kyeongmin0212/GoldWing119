// 질의 답 다듬기 — 에이전트는 문서에 없는 내용을 물으면 정해진 문구
// "문서에서 확인할 수 없음 — 담당자 확인 필요" 로 답한다(숫자를 지어내지 않게 하려는 규칙).
// 규칙은 그대로 두고, 화면에는 그 문구를 자연스러운 문장으로 바꿔 보여 준다.

const FIXED = /문서에서\s*확인할\s*수\s*없(?:음|습니다)\.?\s*(?:[—–-]\s*)?(?:담당자\s*확인(?:이)?\s*필요(?:합니다)?\.?)?/;
const FINE = /과태료|벌금|범칙금|얼마|금액/;

export function friendlyNoDocAnswer(answer: string, question: string): string {
  if (!FIXED.test(answer)) return answer;
  const isFine = FINE.test(question);
  const lead = isFine ? "과태료 금액은 등록된 문서에 없어 안내할 수 없습니다." : "등록된 문서에 없는 내용이라 안내할 수 없습니다.";
  const rest = answer.replace(FIXED, "").replace(/\s+/g, " ").trim();
  const tail = rest || (isFine ? "위반 확정과 과태료는 관할 지자체 담당자가 정합니다." : "담당자에게 확인해 주세요.");
  return `${lead} ${tail}`;
}
