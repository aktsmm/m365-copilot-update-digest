import { slideKind } from "./slides.mjs";

// 原文が変わって、公開中のスライドが古くなった更新を見つける。
// スライドに保存済みの「種類（段階から決まる）」と「原文タイトル」を、現在の更新と比べる。
// 例: 開発中のスライドを作ったあとで、Roadmap が展開中・提供開始に進んだ。
const normalise = (text) => String(text ?? "").replace(/\s+/g, " ").trim();

export function staleReasons(slide, event) {
  const reasons = [];
  if (slide?.kind && slide.kind !== slideKind(event)) reasons.push(`種類が ${slide.kind} から ${slideKind(event)} に変わった`);
  const current = normalise(event.titleEn || event.title);
  if (current && normalise(slide?.title?.en) !== current) reasons.push("原文のタイトルが変わった");
  return reasons;
}

/** slides: Map<id, slide>、events: 更新の配列。古くなっているスライドの ID を返す。 */
export function staleSlideIds(events, slides) {
  return events.filter((event) => slides.has(event.id) && staleReasons(slides.get(event.id), event).length > 0).map((event) => event.id);
}
