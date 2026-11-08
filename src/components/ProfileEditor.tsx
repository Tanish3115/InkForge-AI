import { useRef, useState } from "react";
import {
  Download,
  Upload,
  ScanLine,
  Trash2,
  Plus,
  Check,
  RotateCcw,
} from "lucide-react";
import type { Box, Glyph, Profile } from "../types";
import { canvas, loadImage } from "../engine/image";
import {
  detectMarkers,
  extractGlyph,
  extractSheet,
  warp,
  worksheetPDF,
  type Point,
} from "../engine/worksheet";
import { download } from "../engine/render";
import Dialog from "./Dialog";

export default function ProfileEditor({
  onSave,
  onClose,
  existing,
}: {
  onSave: (p: Profile) => Promise<void>;
  onClose: () => void;
  existing?: Profile;
}) {
  const [name, setName] = useState(existing?.name || "My handwriting"),
    [glyphs, setGlyphs] = useState<Glyph[]>(
      Object.values(existing?.glyphs || {}).flat(),
    );
  const [source, setSource] = useState<HTMLCanvasElement>(),
    [url, setURL] = useState(""),
    [points, setPoints] = useState<Point[]>([]),
    [sheetPage, setSheetPage] = useState(0),
    [threshold, setThreshold] = useState(165);
  const [method, setMethod] = useState<"worksheet" | "manual" | "reference">(
      existing?.kind === "reference" ? "reference" : "worksheet",
    ),
    [label, setLabel] = useState("a"),
    [region, setRegion] = useState<Box | null>(null),
    [baseline, setBaseline] = useState(75),
    [refs, setRefs] = useState<string[]>(existing?.references || []);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const file = useRef<HTMLInputElement>(null),
    start = useRef<Point | null>(null);
  const load = async (image: File) => {
    setError("");
    try {
      const c = await loadImage(image);
      setSource(c);
      setURL(c.toDataURL("image/png"));
      setRegion(null);
      const detected = detectMarkers(c);
      setPoints(detected || []);
      setMessage(
        detected
          ? "Four registration markers detected. Review the points, then extract."
          : "Select marker centers in order: top left, top right, bottom right, bottom left.",
      );
    } catch (e) {
      setError(String(e));
    }
  };
  const point = (event: React.PointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          source!.width,
          ((event.clientX - rect.left) / rect.width) * source!.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          source!.height,
          ((event.clientY - rect.top) / rect.height) * source!.height,
        ),
      ),
    };
  };
  const extract = async () => {
    if (!source) return;
    setBusy(true);
    setError("");
    try {
      if (method === "worksheet") {
        const aligned = warp(source, points),
          items = extractSheet(aligned, sheetPage, threshold);
        setGlyphs((previous) => [...previous, ...items]);
        setMessage(
          `${items.length} real glyphs extracted from page ${sheetPage + 1}. Empty cells were skipped. Review warnings and labels below.`,
        );
      } else if (!region)
        throw new Error("Drag a rectangle around one word or character first.");
      else if (method === "reference") {
        if (refs.length >= 5)
          throw new Error("Remove a reference before adding another.");
        const crop = canvas(region.width, region.height);
        crop
          .getContext("2d")!
          .drawImage(
            source,
            region.x,
            region.y,
            region.width,
            region.height,
            0,
            0,
            crop.width,
            crop.height,
          );
        setRefs((previous) => [...previous, crop.toDataURL("image/png")]);
        setMessage(
          "Reference crop added. Neural conditioning uses all five actual crops.",
        );
      } else {
        if (!label.trim() || label.length > 4)
          throw new Error(
            "Label one character or a ligature of up to four characters.",
          );
        const glyph = extractGlyph(
          source,
          region,
          label,
          region.y + (region.height * baseline) / 100,
          threshold,
        );
        if (!glyph)
          throw new Error(
            "No visible ink found. Adjust the crop or threshold.",
          );
        const factor = 60 / region.height;
        setGlyphs((previous) => [
          ...previous,
          {
            ...glyph,
            width: glyph.width * factor,
            height: glyph.height * factor,
            baseline: glyph.baseline * factor,
            advance: glyph.advance * factor,
          },
        ]);
        setMessage(`Added an actual ink sample for “${label}”.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      if (!name.trim()) throw new Error("Give this profile a name.");
      const mapped: Record<string, Glyph[]> = {};
      for (const glyph of glyphs) {
        if (!glyph.character.trim() || glyph.character.length > 4)
          throw new Error("Review the character labels before saving.");
        (mapped[glyph.character] ||= []).push(glyph);
      }
      if (method === "reference" && refs.length !== 5)
        throw new Error(
          "A neural reference profile needs exactly five cropped samples.",
        );
      if (method !== "reference" && !glyphs.length)
        throw new Error("Extract or add at least one glyph before saving.");
      await onSave({
        id: existing?.id || crypto.randomUUID(),
        name: name.trim().slice(0, 80),
        version: 1,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        em: 60,
        kind: method === "reference" ? "reference" : "glyph",
        glyphs: mapped,
        ...(method === "reference" ? { references: refs } : {}),
      });
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={
        existing ? "Refine your personal style." : "Make the letters yours."
      }
      onClose={onClose}
      wide
    >
      <div className="profile-intro">
        <p>
          Personalization is optional. Extract your actual letters for browser
          rendering, or collect five natural word crops for the local neural
          engine.
        </p>
        <input
          aria-label="Profile name"
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="profile-tabs">
        {[
          { id: "worksheet", name: "Structured worksheet" },
          { id: "manual", name: "Manual glyph crop" },
          { id: "reference", name: "Neural references" },
        ].map((tab) => (
          <button
            key={tab.id}
            className={method === tab.id ? "active" : ""}
            onClick={() => {
              setMethod(tab.id as typeof method);
              setRegion(null);
            }}
          >
            {tab.name}
          </button>
        ))}
      </div>
      <div className="profile-tools">
        {method === "worksheet" && (
          <>
            <button
              className="button"
              onClick={async () => {
                try {
                  download(
                    await worksheetPDF(),
                    "InkForge-handwriting-worksheet.pdf",
                  );
                } catch (e) {
                  setError(String(e));
                }
              }}
            >
              <Download size={15} /> Download A4 worksheet
            </button>
            <label>
              Worksheet page
              <select
                aria-label="Worksheet page"
                value={sheetPage}
                onChange={(e) => setSheetPage(Number(e.target.value))}
              >
                <option value={0}>1 / Letters, digits & punctuation</option>
                <option value={1}>2 / Additional letter variants</option>
              </select>
            </label>
          </>
        )}
        <button className="button" onClick={() => file.current?.click()}>
          <Upload size={15} /> Upload{" "}
          {method === "worksheet" ? "completed sheet" : "handwriting image"}
        </button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg"
          className="sr-only"
          aria-label="Upload handwriting sample"
          onChange={(e) => {
            if (e.target.files?.[0]) void load(e.target.files[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="profile-message">
          {message}
        </p>
      )}
      {source && (
        <div className="extraction-workspace">
          <div className="sample-preview">
            <img src={url} alt="Uploaded handwriting sample" />
            <svg
              viewBox={`0 0 ${source.width} ${source.height}`}
              onPointerDown={(e) => {
                if (method === "worksheet") {
                  if (points.length < 4)
                    setPoints((previous) => [...previous, point(e)]);
                } else {
                  start.current = point(e);
                  e.currentTarget.setPointerCapture(e.pointerId);
                }
              }}
              onPointerMove={(e) => {
                if (!start.current) return;
                const p = point(e);
                setRegion({
                  x: Math.min(p.x, start.current.x),
                  y: Math.min(p.y, start.current.y),
                  width: Math.abs(p.x - start.current.x),
                  height: Math.abs(p.y - start.current.y),
                });
              }}
              onPointerUp={() => {
                start.current = null;
              }}
            >
              {method === "worksheet" &&
                points.map((p, i) => (
                  <g key={i}>
                    <circle cx={p.x} cy={p.y} r={source.width / 55} />
                    <text x={p.x} y={p.y} fontSize={source.width / 40}>
                      {i + 1}
                    </text>
                  </g>
                ))}
              {region && method !== "worksheet" && <rect {...region} />}
            </svg>
          </div>
          <div className="extraction-inspector">
            <h3>
              {method === "worksheet"
                ? "Align, then extract."
                : "Draw a crop on the image."}
            </h3>
            <p>
              {method === "worksheet"
                ? "The four points correspond to the black registration marker centers. If detection is uncertain, select them manually."
                : "Use one character for glyph extraction, or one readable word for each neural reference."}
            </p>
            {method === "worksheet" && (
              <button
                className="button small"
                onClick={() => {
                  setPoints([]);
                  setMessage(
                    "Click top left, top right, bottom right, bottom left registration centers.",
                  );
                }}
              >
                <RotateCcw size={14} /> Select markers manually
              </button>
            )}
            {method !== "reference" && (
              <label>
                Ink threshold <output>{threshold}</output>
                <input
                  aria-label="Ink threshold"
                  type="range"
                  min={70}
                  max={200}
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                />
              </label>
            )}
            {method === "manual" && (
              <>
                <label>
                  Character or ligature
                  <input
                    aria-label="Glyph label"
                    value={label}
                    maxLength={4}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <label>
                  Baseline within crop <output>{baseline}%</output>
                  <input
                    aria-label="Glyph baseline"
                    type="range"
                    min={0}
                    max={100}
                    value={baseline}
                    onChange={(e) => setBaseline(Number(e.target.value))}
                  />
                </label>
              </>
            )}
            <button
              className="button primary"
              disabled={
                busy ||
                (method === "worksheet"
                  ? points.length !== 4
                  : !region || region.width < 3 || region.height < 3)
              }
              onClick={() => void extract()}
            >
              <ScanLine size={16} />
              {method === "worksheet"
                ? "Extract worksheet glyphs"
                : method === "reference"
                  ? "Add reference crop"
                  : "Add glyph variant"}
            </button>
          </div>
        </div>
      )}
      {method === "reference" ? (
        <div className="reference-review">
          <h3>{refs.length} / 5 natural references</h3>
          <p>
            The local DiffusionPen service must be available. This workflow
            synthesizes new words; it does not train a model on these five
            samples.
          </p>
          <div>
            {refs.map((ref, i) => (
              <article key={i}>
                <img src={ref} alt={`Neural style reference ${i + 1}`} />
                <button
                  aria-label={`Remove reference ${i + 1}`}
                  onClick={() =>
                    setRefs((values) => values.filter((_, j) => j !== i))
                  }
                >
                  <Trash2 size={14} />
                </button>
              </article>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="review-heading">
            <h3>
              Review your extracted letters{" "}
              <span>
                {glyphs.length} variants /{" "}
                {new Set(glyphs.map((g) => g.character)).size} characters
              </span>
            </h3>
            <p>
              Adjust a label or baseline, remove a bad sample, or add a
              replacement crop. Missing characters will be shown before export.
            </p>
          </div>
          <div className="glyph-review">
            {glyphs.map((glyph, i) => (
              <article key={glyph.id}>
                <div className="glyph-image">
                  <img
                    src={glyph.ink}
                    alt={`Extracted ${glyph.character} variant`}
                  />
                </div>
                <div>
                  <input
                    aria-label={`Character label ${i + 1}`}
                    value={glyph.character}
                    maxLength={4}
                    onChange={(e) =>
                      setGlyphs((values) =>
                        values.map((g) =>
                          g.id === glyph.id
                            ? { ...g, character: e.target.value }
                            : g,
                        ),
                      )
                    }
                  />
                  <button
                    aria-label={`Delete glyph ${i + 1}`}
                    onClick={() =>
                      setGlyphs((values) =>
                        values.filter((g) => g.id !== glyph.id),
                      )
                    }
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
                <label>
                  Baseline
                  <input
                    aria-label={`Baseline ${i + 1}`}
                    type="number"
                    value={Math.round(glyph.baseline)}
                    onChange={(e) =>
                      setGlyphs((values) =>
                        values.map((g) =>
                          g.id === glyph.id
                            ? { ...g, baseline: Number(e.target.value) }
                            : g,
                        ),
                      )
                    }
                  />
                </label>
                {glyph.warnings.map((warning) => (
                  <small key={warning}>{warning}</small>
                ))}
              </article>
            ))}
          </div>
        </>
      )}
      <footer className="dialog-footer">
        <span>
          <Check size={14} /> Saved locally · export a backup for safekeeping
        </span>
        <button
          className="button primary"
          disabled={busy}
          onClick={() => void save()}
        >
          <Plus size={16} /> Save handwriting profile
        </button>
      </footer>
    </Dialog>
  );
}
