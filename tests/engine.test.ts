import { describe, expect, it } from "vitest";
import { layout, pageSize, seeded } from "../src/engine/layout";
import {
  cells,
  characters,
  homography,
  mapPoint,
  markers,
} from "../src/engine/worksheet";
import { defaults, type GenerationRequest } from "../src/types";
import { validateProfile } from "../src/lib/storage";
const request: GenerationRequest = {
  text: "Words on a page.",
  mode: "default",
  engine: "browser",
  styleId: "classic",
  settings: defaults,
  seed: 42,
  fallback: false,
};
const measure = (text: string) => ({ width: text.length * 14 });
describe("deterministic handwritten layout", () => {
  it("produces identical placement and variation for identical inputs", () => {
    expect(layout(request, measure, 25, 8)).toEqual(
      layout(request, measure, 25, 8),
    );
  });
  it("changes placement when the seed changes", () => {
    expect(layout(request, measure, 25, 8)).not.toEqual(
      layout({ ...request, seed: 43 }, measure, 25, 8),
    );
  });
  it("preserves text, punctuation, newlines and paragraph gaps", () => {
    const pages = layout(
      { ...request, text: "Hello, world!\n\nA new paragraph." },
      measure,
      25,
      8,
    );
    expect(pages[0].items.map((i) => i.text)).toEqual([
      "Hello,",
      "world!",
      "A",
      "new",
      "paragraph.",
    ]);
    expect(pages[0].items[2].y - pages[0].items[0].y).toBeGreaterThan(85);
  });
  it("wraps long words and creates pages with safe vertical bounds", () => {
    const pages = layout(
      { ...request, text: ("longword ".repeat(25) + "\n").repeat(25) },
      measure,
      25,
      8,
    );
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages)
      for (const item of page.items) {
        expect(item.x).toBeGreaterThanOrEqual(defaults.margin);
        expect(item.y + 8).toBeLessThan(page.height - defaults.margin);
      }
  });
  it("honors word spacing and explicit blank lines", () => {
    const a = layout({ ...request, text: "a b" }, measure, 25, 8),
      b = layout(
        { ...request, text: "a b", settings: { ...defaults, wordSpacing: 2 } },
        measure,
        25,
        8,
      );
    expect(b[0].items[1].x).toBeGreaterThan(a[0].items[1].x);
  });
  it("breaks a single long token without discarding characters", () => {
    const word = "a".repeat(150);
    const pages = layout({ ...request, text: word }, measure, 25, 8);
    expect(
      pages
        .flatMap((p) => p.items)
        .map((i) => i.text)
        .join(""),
    ).toBe(word);
  });
  it("uses accurate A4 and US Letter dimensions", () => {
    expect((pageSize("a4").width / 96) * 25.4).toBeCloseTo(210);
    expect(pageSize("letter").height / 96).toBe(11);
  });
  it("uses bounded reproducible random values", () => {
    const a = seeded(42),
      b = seeded(42);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
describe("worksheet geometry and perspective", () => {
  it("maps all labeled cells once and includes common-letter variants", () => {
    expect([...cells(0), ...cells(1)].map((c) => c.character)).toEqual(
      characters,
    );
    expect(characters.filter((c) => c === "a")).toHaveLength(3);
    expect(cells(1).length).toBeGreaterThan(0);
  });
  it("maps canonical marker centers into a perspective quadrilateral", () => {
    const target = [
      { x: 40, y: 75 },
      { x: 890, y: 21 },
      { x: 955, y: 1300 },
      { x: 10, y: 1390 },
    ];
    const h = homography(markers, target);
    markers.forEach((p, i) => {
      const mapped = mapPoint(h, p);
      expect(mapped.x).toBeCloseTo(target[i].x);
      expect(mapped.y).toBeCloseTo(target[i].y);
    });
  });
  it("rejects degenerate alignment points", () => {
    expect(() =>
      homography(markers, Array(4).fill({ x: 10, y: 20 })),
    ).toThrow();
  });
});
describe("profile security and compatibility", () => {
  it("rejects incompatible versions and executable image formats", () => {
    expect(() => validateProfile({ version: 2 })).toThrow();
    expect(() =>
      validateProfile({
        version: 1,
        name: "x",
        em: 60,
        glyphs: {
          a: [
            {
              character: "a",
              width: 20,
              height: 30,
              advance: 23,
              baseline: 25,
              ink: "data:image/svg+xml,script",
            },
          ],
        },
      }),
    ).toThrow();
  });
  it("validates glyph metrics and imports under a fresh ID", () => {
    const input = {
      id: "old",
      version: 1,
      name: "Mine",
      em: 60,
      glyphs: {
        a: [
          {
            id: "1",
            character: "a",
            width: 20,
            height: 30,
            advance: 23,
            baseline: 25,
            ink: "data:image/png;base64,AAAA",
            warnings: [],
          },
        ],
      },
    };
    expect(validateProfile(input).id).not.toBe("old");
  });
});
