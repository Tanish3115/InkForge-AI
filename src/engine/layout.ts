import type { DrawItem, GenerationRequest, PagePlan } from "../types";
export function seeded(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pageSize(format: "a4" | "letter") {
  return format === "a4"
    ? { width: 793.7008, height: 1122.5197 }
    : { width: 816, height: 1056 };
}
export type Measured = Pick<DrawItem, "width" | "glyphs" | "image" | "imageHeight" | "imageBaseline" | "imageEm" | "origin" | "sourceWordId">;
export function layout(
  request: GenerationRequest,
  measure: (text: string) => Measured,
  ascent: number,
  descent: number,
): PagePlan[] {
  const { settings: s } = request,
    size = pageSize(s.format),
    random = seeded(request.seed);
  // Personal samples define the style; decorative jitter should stay subtle.
  const variation = request.mode === "personalized" ? Math.min(s.variation, 0.15) : s.variation;
  if (
    s.margin * 2 + s.size * 4 > size.width ||
    s.margin * 2 + ascent + descent + 20 > size.height
  )
    throw new Error(
      "Margins or writing size leave too little room on the page.",
    );
  const guard = s.size * 0.4,
    lineHeight = Math.max(s.size * s.lineSpacing, ascent + descent + guard);
  const baseline = s.margin + ascent + guard,
    pages: PagePlan[] = [];
  const newPage = () => {
    const p: PagePlan = { ...size, items: [], lineHeight, baseline };
    pages.push(p);
    if (pages.length > 60)
      throw new Error(
        "This document exceeds 60 pages. Split the text into smaller documents.",
      );
    return p;
  };
  let page = newPage(),
    x = s.margin,
    y = baseline;
  const newLine = () => {
    x = s.margin;
    y += lineHeight;
  };
  const ensurePage = () => {
    if (y + descent + guard > size.height - s.margin) {
      page = newPage();
      x = s.margin;
      y = baseline;
    }
  };
  const place = (text: string) => {
    const m = measure(text),
      wordVariation = m.origin === 'uploaded' ? 0 : variation,
      scale = 1 + (random() - 0.5) * 0.035 * wordVariation,
      width = m.width * scale;
    if (x + width > size.width - s.margin - guard && x > s.margin) newLine();
    if (width > size.width - s.margin * 2 - guard && text.length > 1) {
      if (m.image) throw new Error('A handwritten word is wider than the available page. Reduce writing size or margins, then generate again.');
      let part = "";
      for (const ch of text) {
        if (
          part &&
          measure(part + ch).width > size.width - s.margin * 2 - guard
        ) {
          place(part);
          newLine();
          part = "";
        }
        part += ch;
      }
      if (part) place(part);
      return;
    }
    ensurePage();
    const jitter = (random() - 0.5) * s.size * 0.09 * wordVariation;
    page.items.push({
      ...m,
      text,
      x,
      y: y + jitter,
      width,
      rotation: (random() - 0.5) * 0.035 * wordVariation,
      scale,
      opacity: s.opacity * (1 - random() * 0.06 * wordVariation),
    });
    x += width;
  };
  const tokens =
    request.text.replace(/\r\n?/g, "\n").match(/\n|[^\S\n]+|[^\s]+/g) || [];
  for (const token of tokens) {
    if (token === "\n") {
      newLine();
      continue;
    }
    if (/^\s+$/.test(token)) {
      x +=
        [...token.replace(/\t/g, "    ")].length *
        s.size *
        0.32 *
        s.wordSpacing;
      continue;
    }
    place(token);
  }
  return pages;
}
