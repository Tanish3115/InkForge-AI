import type { GenerationRequest, GeneratedDocument, Glyph } from "../types";
import { canvas } from "./image";
import { layout, seeded, type Measured } from "./layout";
import { styles } from "./styles";
import { uploadCoverage, wordKey } from './uploadedWords';

export function isolateProfile(request: GenerationRequest): GenerationRequest {
  return request.mode === 'default' ? {...request, profile: undefined, references: undefined} : request;
}

export async function generate(
  request: GenerationRequest,
  signal?: AbortSignal,
): Promise<GeneratedDocument> {
  request = isolateProfile(request);
  if (!request.text.trim())
    throw new Error("Enter some text to generate handwriting.");
  if (request.text.length > 30000)
    throw new Error("Use up to 30,000 characters per document.");
  const style = styles.find((s) => s.id === request.styleId) || styles[0];
  if (request.engine === 'browser') await document.fonts.load(`${request.settings.size}px "${style.family}"`);
  if (request.engine === 'browser' && !document.fonts.check(`${request.settings.size}px "${style.family}"`))
    throw new Error(
      "The handwriting font could not be loaded. Retry when the font asset is available.",
    );
  const ctx = canvas(1, 1).getContext("2d")!,
    s = request.settings;
  ctx.font = `${s.size}px "${style.family}"`;
  ctx.letterSpacing = `${s.letterSpacing}px`;
  const allowed = new Set(style.characters.map((n) => String.fromCodePoint(n))),
    missing = new Set<string>();
  const variantRandom = seeded(request.seed ^ 73573),
    lastVariants = new Map<string, number>();
  let ascent = ctx.measureText("ÁHjq").actualBoundingBoxAscent,
    descent = ctx.measureText("ÁHjq").actualBoundingBoxDescent;
  if (request.mode === "personalized" && request.engine === "browser") {
    if (!request.profile || !Object.keys(request.profile.glyphs).length)
      throw new Error(
        "Choose a saved glyph profile, or return to Default Handwriting.",
      );
    const glyphs = Object.values(request.profile.glyphs).flat(),
      factor = s.size / request.profile.em;
    ascent = Math.max(s.size * 0.5, ...glyphs.map((g) => g.baseline * factor));
    descent = Math.max(
      s.size * 0.15,
      ...glyphs.map((g) => (g.height - g.baseline) * factor),
    );
  }
  let neural: Map<string, { image: string; width: number }> | undefined;
  const coverage = request.mode === 'personalized' && request.engine === 'neural' ? uploadCoverage(request.text, request.profile) : undefined;
  const reusedWords = [...new Set(coverage?.found || [])];
  let synthesizedWords: string[] = [];
  if (request.engine === "neural") {
    if (
      request.mode === "personalized" &&
      (request.profile?.kind !== "reference" ||
        request.references?.length !== 5)
    )
      throw new Error(
        "Personalized neural synthesis needs five natural reference crops. Use Browser rendering for a glyph profile.",
      );
    const words = coverage?.missing || [...new Set(request.text.match(/\S+/g) || [])];
    synthesizedWords = words;
    if (words.length > 80) throw new Error('Use at most 80 distinct new words per neural request. Words already in your uploaded library do not count toward this limit.');
    if (words.length) {
    const response = await fetch("http://127.0.0.1:8000/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        words,
        style_id: request.styleId,
        references: request.references || [],
        seed: request.seed,
      }),
      signal,
    });
    const result = await response.json();
    if (!response.ok)
      throw new Error(
        (typeof result.detail === 'string' ? result.detail : '') ||
          "The local neural engine could not generate this text. Browser rendering remains available.",
      );
    neural = new Map(
      result.words.map(
        (item: { text: string; image: string; width: number }) => [
          item.text,
          { image: item.image, width: item.width },
        ],
      ),
    );
    }
    ascent = s.size * 0.8;
    descent = s.size * 0.2;
    for (const text of reusedWords) {
      const word = coverage!.index.get(wordKey(text))!;
      ascent = Math.max(ascent, word.baseline * s.size / word.em);
      descent = Math.max(descent, (word.height - word.baseline) * s.size / word.em);
    }
  }
  const measure = (text: string): Measured => {
    const original = coverage?.index.get(wordKey(text));
    if (original) return {
      image: original.image, width: original.width * s.size / original.em,
      imageHeight: original.height, imageBaseline: original.baseline, imageEm: original.em,
      origin: 'uploaded', sourceWordId: original.id,
    };
    if (neural) {
      const image = neural.get(text);
      if (!image)
        throw new Error(
          `The neural service did not return the requested word “${text}”.`,
        );
      return { image: image.image, width: (s.size * image.width) / 64, origin: 'neural' };
    }
    if (request.engine === 'neural') throw new Error(`No handwritten word image is available for "${text}". Reduce the writing size if the word is too wide for the page.`);
    if (request.mode === "default") {
      for (const ch of text) if (!allowed.has(ch)) missing.add(ch);
      return { width: ctx.measureText(text).width };
    }
    const profile = request.profile!,
      pieces: { glyph: Glyph; x: number }[] = [];
    let width = 0;
    const keys = Object.keys(profile.glyphs)
      .filter((k) => profile.glyphs[k].length)
      .sort((a, b) => b.length - a.length);
    for (let i = 0; i < text.length; ) {
      const key = keys.find((k) => text.startsWith(k, i));
      if (!key) {
        missing.add(text[i]);
        width += ctx.measureText(text[i]).width;
        i++;
        continue;
      }
      const variants = profile.glyphs[key];
      let index = Math.floor(variantRandom() * variants.length);
      if (variants.length > 1 && lastVariants.get(key) === index)
        index = (index + 1) % variants.length;
      lastVariants.set(key, index);
      const glyph = variants[index];
      pieces.push({ glyph, x: width });
      width += (glyph.advance * s.size) / profile.em + s.letterSpacing;
      i += key.length;
    }
    return { width, glyphs: pieces };
  };
  const pages = layout(request, measure, ascent, descent);
  if (request.fallback && [...missing].some((ch) => !allowed.has(ch)))
    throw new Error(
      "The selected fallback preset does not support some missing characters. Add samples or choose another preset.",
    );
  return {
    pages,
    request,
    missing: [...missing],
    source:
      request.engine === "neural"
        ? reusedWords.length ? `Original uploaded ink · ${coverage!.found.length} copied words${synthesizedWords.length ? ` / ${synthesizedWords.length} new words synthesized by DiffusionPen` : ''}` : "DiffusionPen · local neural synthesis"
        : request.mode === "personalized"
          ? "Your extracted glyphs \u00b7 browser rendering"
          : `${style.name} · browser preset rendering`,
    reusedWords,
    synthesizedWords,
  };
}
