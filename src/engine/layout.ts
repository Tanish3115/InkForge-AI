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
export type Measured = Pick<DrawItem, "width" | "glyphs" | "image" | "imageHeight" | "imageBaseline" | "imageEm" | "origin" | "sourceWordId" | "renderText" | "fontWeight" | "inkAscent" | "inkDescent" | "inkLeft" | "inkRight">;
export interface MeasureContext {wordIndex:number;offset:number}
export function inkBounds(item:Measured,slant:number){
  const shear=Math.tan(slant*Math.PI/180),a=-shear*(item.inkAscent||0),b=shear*(item.inkDescent||0);
  return {left:(item.inkLeft??0)+Math.min(a,b),right:(item.inkRight??item.width)+Math.max(a,b)};
}
export function layout(
  request: GenerationRequest,
  measure: (text: string,context:MeasureContext) => Measured,
  ascent: number,
  descent: number,
): PagePlan[] {
  const { settings: s } = request,
    size = pageSize(s.format);
  const baselineVariation=Math.max(0,Math.min(1,s.baselineVariation??.15));
  let lineIndex=0,wordIndex=0,lineShift=0,spacing=1;
  const lineStyle=()=>{
    const random=seeded(request.seed^Math.imul(lineIndex+1,104729));
    lineShift=lineShift*.6+(random()-.5)*s.size*.06*baselineVariation;
    spacing=1+(random()-.5)*.025*Math.min(1,s.variation);
  };
  lineStyle();
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
    y = baseline,previousRight=s.margin;
  const newLine = () => {
    x = s.margin;
    y += lineHeight;
    lineIndex++;lineStyle();
    previousRight=s.margin;
  };
  const ensurePage = () => {
    if (y + descent + guard > size.height - s.margin) {
      page = newPage();
      x = s.margin;
      y = baseline;
      previousRight=s.margin;
    }
  };
  const place = (text: string,offset=0) => {
    const m = measure(text,{wordIndex,offset}),scale=1,width=m.width,bounds=inkBounds(m,s.slant);
    const span=(item:Measured)=>{const box=inkBounds(item,s.slant);return Math.max(item.width,box.right)-Math.min(0,box.left);};
    if (span(m) > size.width - s.margin * 2 - guard && text.length > 1) {
      if (m.image||m.glyphs) throw new Error('A handwritten word is wider than the available page. Reduce writing size or margins, then generate again.');
      let part = "",partOffset=offset;
      for (const ch of text) {
        if (
          part &&
          span(measure(part + ch,{wordIndex,offset:partOffset})) > size.width - s.margin * 2 - guard
        ) {
          place(part,partOffset);partOffset+=part.length;
          newLine();
          part = "";
        }
        part += ch;
      }
      if (part) place(part,partOffset);
      return;
    }
    ensurePage();
    const origin=()=>Math.max(x,s.margin-bounds.left,previousRight+(x>s.margin?s.size*.03:0)-bounds.left);
    let placeX=origin();
    if(placeX+Math.max(width,bounds.right)>size.width-s.margin-guard&&x>s.margin){newLine();ensurePage();placeX=origin();}
    if(placeX+Math.max(width,bounds.right)>size.width-s.margin+1)throw new Error('A character or word exceeds the page bounds. Reduce writing size or margins.');
    page.items.push({
      ...m,
      text,
      x:placeX,
      y: y + lineShift,
      width,
      rotation: 0,
      scale,
      opacity: s.opacity,
      line:lineIndex,wordIndex,
    });
    x=placeX+width;previousRight=placeX+bounds.right;
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
        s.wordSpacing*spacing;
      continue;
    }
    place(token);
    wordIndex++;
  }
  return pages;
}
