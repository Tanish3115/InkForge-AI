import type { Profile, WritingDocument } from "../types";
let connection: Promise<IDBDatabase> | undefined;
async function db() {
  connection ??= new Promise((resolve, reject) => {
    const r = indexedDB.open("inkforge-writing", 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("profiles", { keyPath: "id" });
      r.result.createObjectStore("documents", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => {
      connection = undefined;
      reject(r.error);
    };
  });
  return connection;
}
async function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (s: IDBObjectStore) => IDBRequest<T>,
) {
  const database = await db();
  return new Promise<T>((resolve, reject) => {
    const t = database.transaction(store, mode),
      r = operation(t.objectStore(store));
    t.oncomplete = () => resolve(r.result);
    t.onerror = t.onabort = () =>
      reject(
        t.error ||
          new Error("Browser storage is full or unavailable. Export a backup."),
      );
  });
}
export const storage = {
  profiles: () =>
    transact<Profile[]>("profiles", "readonly", (s) => s.getAll()),
  documents: () =>
    transact<WritingDocument[]>("documents", "readonly", (s) => s.getAll()),
  saveProfile: (p: Profile) =>
    transact("profiles", "readwrite", (s) => s.put(p)),
  saveDocument: (d: WritingDocument) =>
    transact("documents", "readwrite", (s) => s.put(d)),
  deleteProfile: (id: string) =>
    transact("profiles", "readwrite", (s) => s.delete(id)),
  deleteDocument: (id: string) =>
    transact("documents", "readwrite", (s) => s.delete(id)),
};
export function validateProfile(value: unknown): Profile {
  const p = value as Profile;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.name !== "string" ||
    !p.name.trim() ||
    p.name.length > 80 ||
    !Number.isFinite(p.em) ||
    p.em < 10 ||
    p.em > 200 ||
    !p.glyphs ||
    typeof p.glyphs !== "object" ||
    Array.isArray(p.glyphs)
  )
    throw new Error("This is not a compatible InkForge glyph profile.");
  let total = 0;
  for (const [key, variants] of Object.entries(p.glyphs)) {
    if (
      !key.trim() ||
      key.length > 4 ||
      !Array.isArray(variants) ||
      variants.length > 12
    )
      throw new Error("Invalid profile character mapping.");
    for (const g of variants) {
      if (
        ++total > 1500 ||
        g.character !== key ||
        ![g.width, g.height, g.advance, g.baseline].every(Number.isFinite) ||
        g.width < 1 ||
        g.height < 1 ||
        g.width > 2048 ||
        g.height > 2048 ||
        g.advance < 1 ||
        g.advance > 2048 ||
        g.baseline < -200 ||
        g.baseline > 2248 ||
        typeof g.ink !== "string" ||
        g.ink.length > 1_000_000 ||
        !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(g.ink)
      )
        throw new Error("A glyph asset or its measurements are invalid.");
      g.warnings = Array.isArray(g.warnings)
        ? g.warnings.filter((w) => typeof w === "string").slice(0, 10)
        : [];
    }
  }
  if (
    !total &&
    !(
      p.kind === "reference" &&
      Array.isArray(p.references) &&
      p.references.length === 5 &&
      p.references.every(
        (url) =>
          typeof url === "string" &&
          url.length < 3_000_000 &&
          /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url),
      )
    )
  )
    throw new Error(
      "The profile has no usable glyphs or five valid neural references.",
    );
  if (p.wordSamples !== undefined) {
    if (!Array.isArray(p.wordSamples) || p.wordSamples.length > 160) throw new Error("Invalid uploaded word library.");
    for (const word of p.wordSamples) {
      if (!word || typeof word.id !== "string" || !word.id || word.id.length > 80 || typeof word.text !== "string" || word.text.length > 160 ||
          ![word.width,word.height,word.baseline,word.em].every(Number.isFinite) || word.width < 1 || word.width > 2600 || word.height < 1 || word.height > 2600 || word.baseline < 0 || word.baseline > word.height || word.em < 1 || word.em > 2600 ||
          typeof word.image !== "string" || word.image.length > 3_000_000 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(word.image) ||
          (word.line !== undefined && (!Number.isInteger(word.line) || word.line < 0 || word.line > 39))) throw new Error("An uploaded word image or its measurements are invalid.");
    }
  }
  if (p.sourceTranscript !== undefined && (typeof p.sourceTranscript !== "string" || p.sourceTranscript.length > 30000)) throw new Error("Invalid sample transcript.");
  if (p.sourceReadWarnings !== undefined && (!Array.isArray(p.sourceReadWarnings) || p.sourceReadWarnings.length > 20 || p.sourceReadWarnings.some(w=>typeof w!=="string" || w.length>1000))) throw new Error("Invalid recognition warnings.");
  return { ...p, id: crypto.randomUUID(), createdAt: Date.now() };
}
export async function importProfile(file: File) {
  if (file.size > 20 * 1024 * 1024)
    throw new Error("Profile backups must be smaller than 20 MiB.");
  return validateProfile(JSON.parse(await file.text()));
}
export async function importDocument(file: File): Promise<WritingDocument> {
  if (file.size > 250000)
    throw new Error("Document backups must be smaller than 250 KiB.");
  const d = JSON.parse(await file.text()) as WritingDocument;
  if (
    !d ||
    d.version !== 1 ||
    typeof d.text !== "string" ||
    d.text.length > 30000 ||
    typeof d.name !== "string" ||
    d.name.length > 80 ||
    typeof d.styleId !== "string" ||
    !["classic", "neat", "casual", "flowing"].includes(d.styleId) ||
    !d.settings ||
    !Number.isInteger(d.seed) ||
    d.seed < 0 ||
    d.seed > 2147483000 ||
    !["browser", "neural"].includes(d.engine)
  )
    throw new Error("This is not a compatible InkForge document backup.");
  const s = d.settings;
  for (const [key, min, max] of [
    ["size", 16, 50],
    ["lineSpacing", 1.1, 2.5],
    ["wordSpacing", 0.6, 2],
    ["letterSpacing", 0, 4],
    ["margin", 25, 110],
    ["variation", 0, 1],
    ["opacity", 0.35, 1],
    ["slant", -12, 12],
  ] as const)
    if (!Number.isFinite(s[key]) || s[key] < min || s[key] > max)
      throw new Error("The backup has invalid rendering settings.");
  if (
    !["a4", "letter"].includes(s.format) ||
    !["plain", "ivory", "ruled", "grid", "dotted"].includes(s.paper) ||
    !/^#[0-9a-f]{6}$/i.test(s.ink)
  )
    throw new Error("The backup has invalid paper or ink settings.");
  return {
    ...d,
    id: crypto.randomUUID(),
    updatedAt: Date.now(),
    fallback: d.fallback === true,
  };
}
