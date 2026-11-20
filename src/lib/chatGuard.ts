// 질의 답 안전장치 — 감독 에이전트가 질문 답에 차량 검증·통보 초안 결과를 섞어 보낸 경우 그 부분을 잘라낸다.
// (질의에는 차량 번호를 보내지 않으므로, 답에 번호판이 나오면 초안 내용이 섞인 것으로 본다)

/** 번호판 모양: 12가 3456, 123나4567 */
const PLATE = /\d{2,3}\s?[가-힣]\s?\d{4}/;
/** 검증·초안 결과 덩어리의 제목 줄: "탐지 차량 검증 / 통보 초안", "### 검증 결과:", "통보 초안:" */
const LEAK_HEADING = /^[\s#>*\-\d.)]*(탐지 차량 검증|차량 검증|비전 검증|검증 결과|통보 초안)(\s*(결과|내용|요약))?\s*(\/|[:：]|—|-|\*\*|$)/m;
/** 우리 메시지(사람이 확인·지자체가 결정)와 반대되는 문장, 초안용 JSON */
const BAD_SENTENCE = /확인(이)?\s*필요\s*(없|하지\s*않)|확인\s*불필요|판단\s*불가|"status"\s*:/;

export function cleanChatAnswer(text: string): { text: string; cut: boolean } {
  const paras = text.split(/\n\s*\n/);
  // 검증·초안 제목이 나온 문단부터 끝까지는 통째로 섞인 것으로 보고 버림
  const head = paras.findIndex((p) => LEAK_HEADING.test(p));
  const before = head >= 0 ? paras.slice(0, head) : paras;
  // 나머지 문단 중 번호판·반대 문장이 있는 줄만 버림
  const kept = before
    .map((p) =>
      p
        .split("\n")
        .filter((line) => !PLATE.test(line) && !BAD_SENTENCE.test(line))
        .join("\n")
        .trim(),
    )
    .filter(Boolean);
  const out = kept.join("\n\n").trim();
  return { text: out, cut: out !== text.trim() };
}
