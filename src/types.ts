export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Glyph {
  id: string;
  character: string;
  width: number;
  height: number;
  baseline: number;
  advance: number;
  ink: string;
  warnings: string[];
}
export interface UploadedWord {
  id: string;
  text: string;
  image: string;
  width: number;
  height: number;
  baseline: number;
  em: number;
  line?: number;
  page?: number;
}
export interface Profile {
  id: string;
  name: string;
  version: 1;
  createdAt: number;
  updatedAt?: number;
  em: number;
  glyphs: Record<string, Glyph[]>;
  kind?: "glyph" | "reference";
  references?: string[];
  automaticSample?: boolean;
  sampleCount?: number;
  wordSamples?: UploadedWord[];
  sourceTranscript?: string;
  sourceReadWarnings?: string[];
  pdf?: {
    totalPages:number;
    pages:number[];
    analysis:{page:number;dpi:number;rotation:number;bodyHeight:number;strokeRatio:number;slant:number}[];
  };
}
export interface Style {
  id: string;
  name: string;
  family: string;
  file: string;
  description: string;
  license: string;
  characters: number[];
}
export interface Settings {
  size: number;
  lineSpacing: number;
  wordSpacing: number;
  letterSpacing: number;
  margin: number;
  variation: number;
  wordConsistency?: number;
  strokeVariation?: number;
  baselineVariation?: number;
  styleFidelity?: number;
  ink: string;
  opacity: number;
  slant: number;
  paper: "plain" | "ivory" | "ruled" | "grid" | "dotted";
  format: "a4" | "letter";
}
export const defaults: Settings = {
  size: 28,
  lineSpacing: 1.65,
  wordSpacing: 1,
  letterSpacing: 0,
  margin: 55,
  variation: 0.22,
  wordConsistency: 0.9,
  strokeVariation: 0.12,
  baselineVariation: 0.15,
  styleFidelity: 0.9,
  ink: "#243d82",
  opacity: 0.95,
  slant: 0,
  paper: "ivory",
  format: "a4",
};
export interface WritingDocument {
  mode?: "default" | "personalized";
  id: string;
  name: string;
  text: string;
  styleId: string;
  profileId?: string;
  engine: "browser" | "neural";
  fallback: boolean;
  seed: number;
  settings: Settings;
  updatedAt: number;
  version: 1;
}
export interface GenerationRequest {
  text: string;
  mode: "default" | "personalized";
  engine: "browser" | "neural";
  styleId: string;
  profile?: Profile;
  references?: string[];
  settings: Settings;
  seed: number;
  fallback: boolean;
}
export interface DrawItem {
  inkLeft?: number;
  inkRight?: number;
  renderText?: string;
  fontWeight?: number;
  line?: number;
  wordIndex?: number;
  inkAscent?: number;
  inkDescent?: number;
  text: string;
  x: number;
  y: number;
  width: number;
  rotation: number;
  scale: number;
  opacity: number;
  glyphs?: { glyph: Glyph; x: number }[];
  image?: string;
  imageHeight?: number;
  imageBaseline?: number;
  imageEm?: number;
  origin?: 'uploaded' | 'neural';
  sourceWordId?: string;
}
export interface PagePlan {
  width: number;
  height: number;
  items: DrawItem[];
  lineHeight: number;
  baseline: number;
}
export interface GeneratedDocument {
  renderSettings?: Settings;
  quality?: HandwritingQuality;
  pages: PagePlan[];
  request: GenerationRequest;
  missing: string[];
  source: string;
  reusedWords?: string[];
  synthesizedWords?: string[];
}
export interface HandwritingQuality {
  nominalSize: number;
  effectiveSize: number;
  checkedWords: number;
  checkedLines: number;
  checkedPages: number;
  normalizedImages: number;
  sizeCorrections: number;
  variantsUsed: number;
  warnings: string[];
}
export interface NeuralStatus {
  ready: boolean;
  reason: string;
  device?: string;
  styles: { id: string; name: string; provenance: string; preview?: string }[];
}
