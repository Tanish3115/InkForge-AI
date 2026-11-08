import "../styles/studio-future.css";
import { useState } from "react";
import SampleUpload from "./SampleUpload";
import UploadedWordLibrary from './UploadedWordLibrary';
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  PenLine,
  Plus,
  FileText,
  SlidersHorizontal,
  Download,
  RotateCcw,
  Save,
  Trash2,
  Upload,
  Undo2,
  Redo2,
  Check,
  X,
  PanelLeft,
  ShieldCheck,
  LoaderCircle,
  Cable,
} from "lucide-react";
import type { Settings, WritingDocument } from "../types";
import { defaults } from "../types";
import { styles } from "../engine/styles";
import { download } from "../engine/render";
import { importProfile, importDocument, storage } from "../lib/storage";
import { Brand } from "./Landing";
import Preview from "./Preview";
import ProfileEditor from "./ProfileEditor";
import Dialog from "./Dialog";

import { useStudio } from "./useStudio";

export default function Studio({ onHome }: { onHome: () => void }) {
  const [sampleUpload, setSampleUpload] = useState(false);
  const reducedMotion = useReducedMotion();
  const {
    text,
    settings,
    setSettings,
    styleId,
    choosePreset,
    presetStyleId,
    setNeuralStyle,
    seed,
    mode,
    setMode,
    engine,
    setEngine,
    profiles,
    setProfiles,
    profileId,
    deselectProfile,
    documents,
    setDocuments,
    documentId,
    setDocumentId,
    name,
    setName,
    generated,
    setGenerated,
    busy,
    exporting,
    fallback,
    setFallback,
    error,
    setError,
    message,
    profileEditor,
    setProfileEditor,
    editing,
    setEditing,
    exportPage,
    setExportPage,
    exportOpen,
    setExportOpen,
    sidebar,
    setSidebar,
    inspector,
    setInspector,
    neural,
    connecting,
    documentInput,
    backupInput,
    history,
    position,
    profile,
    notify,
    changeText,
    undo,
    stale,
    create,
    connect,
    set,
    save,
    chooseProfile,
    saveProfile,
    updateProfile,
    openDocument,
    exportFile,
  } = useStudio();
  return (
    <motion.div className="studio" initial={{opacity:0}} animate={{opacity:1}} transition={{duration:reducedMotion?0:.4}}>
      <div className="studio-ambient" aria-hidden="true"><span/><span/><i/></div>
      <header className="studio-header">
        <button
          className="brand-home"
          onClick={onHome}
          disabled={busy}
          aria-label="Back to home"
        >
          <Brand />
        </button>
        <span className="studio-breadcrumb">
          / <PenLine size={13} /> Writing studio
        </span>
        <div>
          <span className="local-label">
            <ShieldCheck size={13} /> Local first
          </span>
          <button
            className="button small"
            disabled={busy}
            onClick={() => void save()}
          >
            <Save size={14} /> Save
          </button>
          <button
            className="button small primary"
            disabled={!generated || busy || stale}
            onClick={() => setExportOpen(true)}
          >
            <Download size={14} /> Export
          </button>
        </div>
      </header>
      <div className="studio-mobile">
        <button onClick={() => setSidebar((v) => !v)} aria-expanded={sidebar}>
          <PanelLeft size={15} /> Library
        </button>
        <button
          onClick={() => setInspector((v) => !v)}
          aria-expanded={inspector}
        >
          <SlidersHorizontal size={15} /> Paper & writing
        </button>
      </div>
      <aside className={`studio-sidebar ${sidebar ? "open" : ""}`}>
        <span className="eyebrow">YOUR CREATIVE SPACE</span>
        <button
          className="button new-doc"
          disabled={busy}
          onClick={() => {
            if (
              text &&
              !confirm(
                "Start a new draft? Save the current text first if you need it.",
              )
            )
              return;
            setDocumentId("");
            setName("Untitled document");
            changeText("");
            setGenerated(null);
          }}
        >
          <Plus size={16} /> New document
        </button>
        <div className="sidebar-heading">
          HANDWRITING <span>{profiles.length + 4}</span>
        </div>
        <button
          className={`sidebar-item ${mode === "default" ? "active" : ""}`}
          onClick={() => setMode("default")}
        >
          <PenLine size={16} /> Default handwriting
        </button>
        <button
          className={`sidebar-item ${mode === "personalized" ? "active" : ""}`}
          onClick={() => setMode("personalized")}
        >
          <ScanIcon /> My handwriting <span>{profiles.length}</span>
        </button>
        <div className="sidebar-profiles">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={
                p.id === profileId && mode === "personalized" ? "selected" : ""
              }
            >
              <button onClick={() => chooseProfile(p)}>
                <span>{p.name}</span>
                <small>
                  {p.kind === "reference"
                    ? "Neural reference profile"
                    : `${Object.keys(p.glyphs).length} sampled characters`}
                </small>
              </button>
              <button
                aria-label={`Edit ${p.name}`}
                onClick={() => {
                  setEditing(p);
                  setProfileEditor(true);
                }}
              >
                <PenLine size={12} />
              </button>
            </div>
          ))}
        </div>
        <button
          className="sidebar-add"
          onClick={() => {
            setSampleUpload(true);
          }}
        >
          <Plus size={14} /> Upload handwriting sample
        </button>
        <button
          className="sidebar-add"
          onClick={() => backupInput.current?.click()}
        >
          <Upload size={13} /> Import profile backup
        </button>
        <input
          ref={backupInput}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Import profile"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              await saveProfile(await importProfile(f));
            } catch (error) {
              setError(String(error));
            }
            e.target.value = "";
          }}
        />
        <button
          className="sidebar-add"
          onClick={() => documentInput.current?.click()}
        >
          <Upload size={13} /> Import document backup
        </button>
        <input
          ref={documentInput}
          className="sr-only"
          type="file"
          accept="application/json,.json"
          aria-label="Import document backup"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) {
              try {
                const doc = await importDocument(file);
                await storage.saveDocument(doc);
                setDocuments((previous) => [doc, ...previous]);
                openDocument(doc);
                notify("Document backup imported.");
              } catch (error) {
                setError(String(error));
              }
            }
            e.target.value = "";
          }}
        />
        <div className="sidebar-heading recent-heading">
          RECENT DOCUMENTS <span>{documents.length}</span>
        </div>
        <div className="recent-docs">
          {documents.length ? (
            documents.map((d) => (
              <div key={d.id}>
                <button disabled={busy} onClick={() => openDocument(d)}>
                  <FileText size={14} />
                  <span>
                    {d.name}
                    <small>{new Date(d.updatedAt).toLocaleDateString()}</small>
                  </span>
                </button>
                <button
                  aria-label={`Delete document ${d.name}`}
                  onClick={async () => {
                    if (
                      !confirm("Delete this saved document from this browser?")
                    )
                      return;
                    try {
                      await storage.deleteDocument(d.id);
                      setDocuments((previous) =>
                        previous.filter((item) => item.id !== d.id),
                      );
                      if (documentId === d.id) setDocumentId("");
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))
          ) : (
            <p>Your saved drafts will appear here.</p>
          )}
        </div>
        <div className="sidebar-bottom">
          <ShieldCheck size={17} />
          <p>
            Made here. Kept here.
            <small>Export a backup. Browser storage can be cleared.</small>
          </p>
        </div>
      </aside>
      <main className="studio-main">
        <div className="studio-title">
          <div>
            <span className="eyebrow studio-kicker"><span aria-hidden="true"/>YOUR WORDS. YOUR SIGNATURE.</span>
            <input
              aria-label="Document name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <span
            className={`engine-status ${engine === "neural" && neural.ready ? "neural" : ""}`}
          >
            <span className="dot" />
            {engine === "browser"
              ? "Browser rendering active"
              : neural.ready
                ? "Neural engine available"
                : mode === 'personalized' && profile?.wordSamples?.length ? "Uploaded word reuse ready" : "Neural engine unavailable"}
          </span>
        </div>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button aria-label="Dismiss error" onClick={() => setError("")}>
              <X size={16} />
            </button>
          </div>
        )}
        <div className="generation-mode" aria-label="Handwriting mode">
          <button
            className={mode === "default" ? "selected" : ""}
            aria-pressed={mode === "default"}
            onClick={() => setMode("default")}
          >
            <PenLine size={16} />
            <span>
              Default handwriting
              <small>A style you love. No upload needed.</small>
            </span>
            <Check size={14} />
          </button>
          <button
            className={mode === "personalized" ? "selected" : ""}
            aria-pressed={mode === "personalized"}
            onClick={() => setMode("personalized")}
          >
            <ScanIcon />
            <span>
              My handwriting
              <small>Upload a sample, type, and generate.</small>
            </span>
            <Check size={14} />
          </button>
        </div>
        {mode === "default" ? (
          <div className="style-picker" aria-label="Choose a handwriting style">
            {styles.map((s) => (
                <button
                  key={s.id}
                  className={engine === "browser" && presetStyleId === s.id ? "selected" : ""}
                  aria-pressed={engine === "browser" && presetStyleId === s.id}
                  onClick={() => choosePreset(s.id)}
                >
                  <span style={{ fontFamily: s.family }}>
                    Dear you,
                  </span>
                  <strong>
                    {s.name}
                    <i>BROWSER</i>
                  </strong>
                </button>
              ))}
          </div>
        ) : (
          <div className="personal-selection">
            {profile?.kind === "reference" && <UploadedWordLibrary profile={profile} text={text} onUpdate={updateProfile} onUseText={changeText} />}
            {profile && profile.kind !== "reference" && <div role="status"><strong>Advanced letter profile selected</strong><p>This older profile only contains individually sampled letters. For automatic generation of new text, upload your original handwriting image using Upload handwriting sample.</p></div>}
            {profile?.automaticSample && <details className="source-reference-details"><summary><Check size={13}/><strong>Sample ready</strong><span>{profile.sampleCount} style references</span></summary><div className="source-reference-strip">{profile.references?.slice(0, profile.sampleCount).map((src,i)=><img key={i} src={src} alt={`Selected handwriting reference ${i+1}`}/>)}</div><p>These references guide new-word synthesis. Matching words keep their original uploaded ink.</p></details>}
            <div className="personal-toolbar">
            {profiles.length ? (
              <>
                <label>
                  Personal profile
                  <select
                    aria-label="Personal profile"
                    value={profileId}
                    onChange={(e) => {
                      const p = profiles.find(
                        (item) => item.id === e.target.value,
                      );
                      if (p) chooseProfile(p);
                      else deselectProfile();
                    }}
                  >
                    <option value="">Choose a profile</option>
                    {profiles.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name} /{" "}
                        {p.kind === "reference" ? "neural" : "glyphs"}
                      </option>
                    ))}
                  </select>
                </label>
                {profile && (
                  <>
                    <button className="button small deselect-profile" onClick={deselectProfile} title="Deselect handwriting sample" aria-label="Deselect handwriting sample"><X size={14}/><span>Deselect sample</span></button>
                    <button
                      title="Export profile backup"
                      aria-label="Export profile backup"
                      onClick={() =>
                        download(
                          new Blob([JSON.stringify(profile)], {
                            type: "application/json",
                          }),
                          `${profile.name}-profile.json`,
                        )
                      }
                    >
                      <Download size={16} />
                    </button>
                    <button
                      title="Delete profile"
                      aria-label="Delete profile"
                      onClick={async () => {
                        if (
                          !confirm(
                            "Delete this profile? Export a backup first.",
                          )
                        )
                          return;
                        try {
                          await storage.deleteProfile(profile.id);
                          setProfiles((values) =>
                            values.filter((p) => p.id !== profile.id),
                          );
                          deselectProfile();
                        } catch (e) {
                          setError(String(e));
                        }
                      }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </>
                )}
              </>
            ) : (
              <div>
                <strong>Your handwriting can live here.</strong>
                <p>
                  Upload a photo of your handwriting. We select references
                  automatically; no letter labels or manual crops needed.
                </p>
              </div>
            )}
            <button
              className="button small"
              onClick={() => {
                setSampleUpload(true);
              }}
            >
              <Upload size={14} /> Upload handwriting sample
            </button>
            </div>
          </div>
        )}
        <div className="writing-workspace">
          <section className="composition">
            <header>
              <span>
                <span className="panel-index" aria-hidden="true">01</span><TypeIcon /> DIGITAL TEXT
              </span>
              <div>
                <button
                  aria-label="Undo text change"
                  disabled={position.current === 0}
                  onClick={() => undo(-1)}
                >
                  <Undo2 size={14} />
                </button>
                <button
                  aria-label="Redo text change"
                  disabled={position.current >= history.current.length - 1}
                  onClick={() => undo(1)}
                >
                  <Redo2 size={14} />
                </button>
                <button
                  aria-label="Clear text"
                  disabled={!text}
                  onClick={() => changeText("")}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </header>
            <textarea
              aria-label="Digital text"
              placeholder="Type or paste your words here…"
              value={text}
              maxLength={30000}
              onChange={(e) => changeText(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
                  e.preventDefault();
                  undo(e.shiftKey ? 1 : -1);
                }
              }}
            />
            <footer>
              <span>{text.length.toLocaleString()} characters</span>
              <span>
                {text.trim() ? text.trim().split(/\s+/).length : 0} words
              </span>
            </footer>
            <div className="composition-actions">
              <button
                className="button primary full"
                disabled={
                  busy || !text.trim() || (mode === "personalized" && !profile)
                }
                onClick={() => void create()}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <PenLine size={16} />
                )}{" "}
                Generate handwriting
              </button>
              <button
                className="regenerate"
                disabled={busy || !text.trim()}
                onClick={() => void create((seed + 1) % 2147483000)}
              >
                <RotateCcw size={13} /> Regenerate with a new seed{" "}
                <span>{seed}</span>
              </button>
              <p>
                <ShieldCheck size={13} /> Your text is the source of truth. It
                is never paraphrased.
              </p>
            </div>
          </section>
          <Preview doc={generated} busy={busy} personalized={mode === "personalized"} sampleReady={!!profile} />
        </div>
        <div className="output-status">
          <span>
            {generated
              ? generated.source
              : "Choose a style, then generate your first page."}
          </span>
          <span>
            {generated && stale
              ? "Changes ready · generate to update preview"
              : generated
                ? "Preview and export use the same layout"
                : "No upload required for default handwriting"}
          </span>
        </div>
        {generated?.missing.length ? (
          <div className="missing-warning">
            Missing characters: <strong>{generated.missing.join(" ")}</strong>.
            {mode === "personalized" ? " This advanced letter profile cannot draw those letters. Upload your original handwriting image for automatic sample-based generation." : " Choose another preset or edit the unsupported characters."}
            {mode === "personalized" && <button className="button small" onClick={() => setSampleUpload(true)}>Upload sample for automatic generation</button>}
            {mode === "personalized" && engine === "browser" && (
              <label>
                <input
                  type="checkbox"
                  checked={fallback}
                  onChange={(e) => setFallback(e.target.checked)}
                />{" "}
                Use the selected browser preset for missing characters. Generate
                again to apply.
              </label>
            )}
          </div>
        ) : null}
      </main>
      <aside className={`studio-inspector ${inspector ? "open" : ""}`}>
        <header>
          <SlidersHorizontal size={15} /> THE FINISHING TOUCHES
          <button
            className="inspector-close"
            aria-label="Close inspector"
            onClick={() => setInspector(false)}
          >
            <X size={16} />
          </button>
        </header>
        <section>
          <span className="eyebrow">01 / THE PAGE</span>
          <div className="select-row">
            <label>
              Page size
              <select
                aria-label="Page size"
                value={settings.format}
                onChange={(e) =>
                  set("format", e.target.value as Settings["format"])
                }
              >
                <option value="a4">A4 / 210 × 297 mm</option>
                <option value="letter">US Letter / 8.5 × 11 in</option>
              </select>
            </label>
          </div>
          <div className="paper-options">
            {(["plain", "ivory", "ruled", "grid", "dotted"] as const).map(
              (p) => (
                <button
                  key={p}
                  className={`paper-swatch ${p} ${settings.paper === p ? "selected" : ""}`}
                  aria-label={`${p} paper`}
                  aria-pressed={settings.paper === p}
                  onClick={() => set("paper", p)}
                >
                  <i />
                  <span>{p}</span>
                </button>
              ),
            )}
          </div>
          <Slider
            title="Margins"
            value={settings.margin}
            min={25}
            max={110}
            unit="px"
            onChange={(v) => set("margin", v)}
          />
        </section>
        <section>
          <span className="eyebrow">02 / THE INK</span>
          <div className="ink-options">
            {["#243d82", "#202129", "#102c51", "#41334f"].map((color) => (
              <button
                key={color}
                aria-label={`Ink ${color}`}
                className={settings.ink === color ? "selected" : ""}
                style={{ background: color }}
                onClick={() => set("ink", color)}
              >
                {settings.ink === color && <Check size={13} />}
              </button>
            ))}
            <label title="Custom ink color">
              <input
                aria-label="Custom ink color"
                type="color"
                value={settings.ink}
                onChange={(e) => set("ink", e.target.value)}
              />
              <Plus size={15} />
            </label>
          </div>
          <Slider
            title="Ink opacity"
            value={settings.opacity}
            min={0.35}
            max={1}
            step={0.05}
            onChange={(v) => set("opacity", v)}
          />
        </section>
        <section>
          <span className="eyebrow">03 / THE RHYTHM</span>
          <Slider
            title="Writing size"
            value={settings.size}
            min={16}
            max={50}
            unit="px"
            onChange={(v) => set("size", v)}
          />
          <Slider
            title="Line spacing"
            value={settings.lineSpacing}
            min={1.1}
            max={2.5}
            step={0.05}
            unit="×"
            onChange={(v) => set("lineSpacing", v)}
          />
          <Slider
            title="Word spacing"
            value={settings.wordSpacing}
            min={0.6}
            max={2}
            step={0.05}
            unit="×"
            onChange={(v) => set("wordSpacing", v)}
          />
          <Slider
            disabled={engine === "neural"}
            title="Letter spacing"
            value={settings.letterSpacing}
            min={0}
            max={4}
            step={0.2}
            unit="px"
            onChange={(v) => set("letterSpacing", v)}
          />
          <Slider
            title="Natural variation"
            value={settings.variation}
            min={0}
            max={1}
            step={0.05}
            onChange={(v) => set("variation", v)}
          />
          <Slider
            title="Writing slant"
            value={settings.slant}
            min={-12}
            max={12}
            unit="°"
            onChange={(v) => set("slant", v)}
          />
          <button
            className="reset-settings"
            onClick={() => setSettings({ ...defaults })}
          >
            <RotateCcw size={13} /> Reset writing & paper defaults
          </button>
        </section>
        <section className="neural-section">
          <span className="eyebrow">04 / THE ENGINE</span>
          <label>
            Generation engine
            <select
              aria-label="Generation engine"
              value={engine}
              onChange={(e) => setEngine(e.target.value as typeof engine)}
            >
              <option value="browser" disabled={mode === "personalized" && profile?.kind === "reference"}>Browser rendering</option>
              <option value="neural">Local neural synthesis</option>
            </select>
          </label>
          <p>
            {engine === "browser"
              ? "Licensed preset fonts or your extracted glyphs. No model training is implied."
              : neural.reason}
          </p>
          <button
            className="button small full"
            disabled={connecting || busy}
            onClick={() => void connect()}
          >
            {connecting ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <Cable size={14} />
            )}{" "}
            Check local neural service
          </button>
          {engine === "neural" && mode === "default" && <label className="neural-reference-condition">Neural reference condition<select aria-label="Neural reference condition" value={styleId} onChange={e=>setNeuralStyle(e.target.value)}>{neural.styles.map(style=><option key={style.id} value={style.id}>{style.name}</option>)}</select>{neural.styles.find(style=>style.id===styleId)?.preview && <img className="neural-style-preview" src={neural.styles.find(style=>style.id===styleId)!.preview} alt="Actual verified neural reference preview"/>}<small>Experimental synthesis is active. Choose any default font card to use that exact browser font.</small></label>}
          {engine === "neural" && (
            <p>
              Five style references condition the pretrained model. Default
              references come from licensed fonts. Letter spacing is available
              in browser mode. Review generated spelling and readability.
            </p>
          )}
        </section>
        <div className="inspector-note">
          <ShieldCheck size={15} />
          <p>
            Text, profiles, and settings are stored in this browser when saved.
            Exports are your backup.
          </p>
        </div>
      </aside>
      <AnimatePresence>
        {message && (
          <motion.div
            className="toast"
            role="status"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <Check size={15} />
            {message}
          </motion.div>
        )}
      </AnimatePresence>
      {sampleUpload && <SampleUpload onSave={saveProfile} onClose={() => setSampleUpload(false)} onAdvanced={() => { setSampleUpload(false); setEditing(undefined); setProfileEditor(true); }} />}
      {profileEditor && (
        <ProfileEditor
          existing={editing}
          onSave={saveProfile}
          onClose={() => setProfileEditor(false)}
        />
      )}
      {exportOpen && generated && (
        <Dialog
          title="Take your words with you."
          onClose={() => {
            if (!exporting) setExportOpen(false);
          }}
        >
          <p className="dialog-copy">
            Exports contain the actual generated handwriting at 300 DPI,
            including paper backgrounds and all current preview settings.
          </p>
          <label className="export-page-select">
            PNG page
            <select
              aria-label="PNG page"
              value={exportPage}
              onChange={(e) => setExportPage(Number(e.target.value))}
            >
              {generated.pages.map((_, index) => (
                <option value={index} key={index}>
                  Page {index + 1}
                </option>
              ))}
            </select>
          </label>
          <button
            className="button full project-backup"
            onClick={() => {
              const doc: WritingDocument = {
                            id: documentId || crypto.randomUUID(),
                name,
                text,
                styleId,
                settings,
                seed,
                engine,
                fallback,
                profileId: mode === "personalized" ? profileId : undefined,
                version: 1,
                updatedAt: Date.now(),
              };
              download(
                new Blob([JSON.stringify(doc)], { type: "application/json" }),
                `${name || "InkForge"}-document.json`,
              );
              notify(
                "Editable project backup downloaded. Export a personal profile separately if used.",
              );
              setExportOpen(false);
            }}
          >
            <Save size={15} /> Download editable project backup
          </button>
          <div className="export-options">
            {[
              {
                id: "pdf",
                title: "Handwritten PDF",
                description:
                  "All pages, correct paper dimensions, print-ready.",
              },
              {
                id: "png",
                title: "Page PNG",
                description:
                  "A high-resolution image of the page selected above.",
              },
              {
                id: "all",
                title: "All pages as PNG",
                description: "Every handwritten page in a ZIP archive.",
              },
            ].map((item) => (
              <button
                key={item.id}
                disabled={exporting}
                onClick={() =>
                  void exportFile(item.id as "pdf" | "png" | "all")
                }
              >
                <FileText size={22} />
                <span>
                  <strong>{item.title}</strong>
                  <small>{item.description}</small>
                </span>
                <Download size={17} />
              </button>
            ))}
          </div>
          {exporting && (
            <p role="status" className="export-progress">
              <LoaderCircle size={16} className="spin" /> Rendering actual
              high-resolution pages…
            </p>
          )}
        </Dialog>
      )}
    </motion.div>
  );
}
function Slider({
  title,
  value,
  min,
  max,
  step = 1,
  unit = "",
  disabled = false,
  onChange,
}: {
  title: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span>
        {title}
        <output>
          {Number(value.toFixed(2))}
          {unit}
        </output>
      </span>
      <input
        aria-label={title}
        disabled={disabled}
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}
function ScanIcon() {
  return (
    <span className="scan-icon">
      <PenLine size={15} />
    </span>
  );
}
function TypeIcon() {
  return (
    <span className="type-icon">
      T<span>t</span>
    </span>
  );
}
