import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  Minus,
  Plus,
  Maximize2,
  FileText,
  LoaderCircle,
} from "lucide-react";
import type { GeneratedDocument } from "../types";
import { renderPage } from "../engine/render";
export default function Preview({
  doc,
  busy,
  personalized = false,
  sampleReady = false,
}: {
  doc: GeneratedDocument | null;
  busy: boolean;
  personalized?: boolean;
  sampleReady?: boolean;
}) {
  const reducedMotion = useReducedMotion();
  const [index, setIndex] = useState(0),
    [zoom, setZoom] = useState(1),
    [error, setError] = useState(""),
    [drawing, setDrawing] = useState(false);
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    setIndex(0);
  }, [doc]);
  const page = doc?.pages[Math.min(index, doc.pages.length - 1)];
  useEffect(() => {
    if (!doc) return;
    let canceled = false;
    setDrawing(true);
    setError("");
    renderPage(doc, Math.min(index, doc.pages.length - 1), 1.25)
      .then((c) => {
        if (!canceled && ref.current) {
          ref.current.width = c.width;
          ref.current.height = c.height;
          ref.current.getContext("2d")!.drawImage(c, 0, 0);
        }
      })
      .catch((e) => {
        if (!canceled) setError(String(e));
      })
      .finally(() => {
        if (!canceled) setDrawing(false);
      });
    return () => {
      canceled = true;
    };
  }, [doc, index]);
  return (
    <section className="preview">
      <div className="preview-top">
        <span>
          <span className="panel-index" aria-hidden="true">02</span><span className="dot" /> HANDWRITING PREVIEW
        </span>
        <div>
          <button
            aria-label="Zoom out"
            onClick={() => setZoom((v) => Math.max(0.4, v - 0.1))}
          >
            <Minus size={14} />
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in"
            onClick={() => setZoom((v) => Math.min(2.5, v + 0.1))}
          >
            <Plus size={14} />
          </button>
          <button aria-label="Fit page" onClick={() => setZoom(1)}>
            <Maximize2 size={14} />
          </button>
        </div>
      </div>
      <div className="paper-workspace">
        {doc ? (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reducedMotion ? 0 : .35 }}
            className="preview-page"
            style={{
              width: `${zoom * 100}%`,
              aspectRatio: page ? `${page.width}/${page.height}` : undefined,
            }}
          >
            <canvas
              ref={ref}
              aria-label={`Generated handwriting page ${index + 1}`}
            />
          </motion.div>
        ) : (
          <div className="preview-placeholder">
            <div className="preview-orbit" aria-hidden="true">
              <div className="orbit-track orbit-track-one"/><div className="orbit-track orbit-track-two"/>
              <span className="orbit-node"/>
              <div className="preview-document"><FileText size={34}/><svg viewBox="0 0 90 40"><path d="M4 17 C13 1 15 31 24 16 S37 6 41 20 S50 5 56 17 S68 5 73 16 S81 13 86 11"/><path d="M17 32H72"/></svg></div>
            </div>
            <span className="preview-eyebrow">A LITTLE INK. ENDLESS POSSIBILITY.</span>
            <h3>
              Your next page<br/><em>starts here.</em>
            </h3>
            <p>
              {personalized ? sampleReady ? 'Your sample is ready. Type your words and bring them onto the page.' : 'Upload your handwriting sample, then type the words you want to create.' : 'Choose a style, add your words, and watch your page take shape.'}
            </p>
            <div className="preview-mini-tags"><span>Live canvas</span><i/><span>Print-ready export</span></div>
          </div>
        )}
        {(busy || drawing) && <div className="preview-scan" aria-hidden="true"><span/></div>}
        {(busy || drawing) && (
          <span className="rendering-badge" role="status">
            <LoaderCircle size={14} className="spin" />
            {busy ? "Generating actual handwriting…" : "Rendering page…"}
          </span>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="preview-bottom">
        <span>
          {doc
            ? `${doc.pages.length} page${doc.pages.length > 1 ? "s" : ""} · ${doc.request.settings.format.toUpperCase()}`
            : "A4 · Ready when you are"}
        </span>
        <div>
          <button
            aria-label="Previous page"
            disabled={!doc || !index}
            onClick={() => setIndex((i) => i - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>{doc ? `${index + 1} / ${doc.pages.length}` : "—"}</span>
          <button
            aria-label="Next page"
            disabled={!doc || index >= doc.pages.length - 1}
            onClick={() => setIndex((i) => i + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
        <span>300 DPI exports</span>
      </div>
    </section>
  );
}
