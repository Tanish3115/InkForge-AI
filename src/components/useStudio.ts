import { useCallback, useEffect, useRef, useState } from "react";
import type {
  GeneratedDocument,
  NeuralStatus,
  Profile,
  Settings,
  WritingDocument,
} from "../types";
import { defaults } from "../types";
import { generate } from "../engine/generate";
import { download, exportAllPNG, exportPDF, exportPNG } from "../engine/render";
import { storage } from "../lib/storage";
import { uploadCoverage } from '../engine/uploadedWords';

export function useStudio() {
  const [text, setText] = useState(
    "Artificial intelligence is transforming the future of technology.\n\nMake every word your own.",
  );
  const [settings, setSettings] = useState<Settings>({ ...defaults }),
    [presetStyleId, setPresetStyle] = useState("classic"),
    [neuralStyleId, setNeuralStyleState] = useState("classic"),
    [seed, setSeed] = useState(42),
    [mode, setModeState] = useState<"default" | "personalized">("default"),
    [defaultEngine, setDefaultEngine] = useState<"browser" | "neural">("browser"),
    [personalEngine, setPersonalEngine] = useState<"browser" | "neural">("browser");
  const [profiles, setProfiles] = useState<Profile[]>([]),
    [profileId, setProfileId] = useState(""),
    [documents, setDocuments] = useState<WritingDocument[]>([]),
    [documentId, setDocumentId] = useState(""),
    [name, setName] = useState("A little more human");
  const [generated, setGenerated] = useState<GeneratedDocument | null>(null),
    [busy, setBusy] = useState(false),
    [exporting, setExporting] = useState(false),
    [fallback, setFallback] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [profileEditor, setProfileEditor] = useState(false),
    [editing, setEditing] = useState<Profile>(),
    [exportPage, setExportPage] = useState(0),
    [exportOpen, setExportOpen] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [inspector, setInspector] = useState(false);
  const [neural, setNeural] = useState<NeuralStatus>({
      ready: false,
      reason: "The optional local neural service is not connected.",
      styles: [],
    }),
    [connecting, setConnecting] = useState(false);
  const documentInput = useRef<HTMLInputElement>(null),
    backupInput = useRef<HTMLInputElement>(null),
    controller = useRef<AbortController | null>(null),
    selectionVersion = useRef(0),
    connectionVersion = useRef(0),
    history = useRef([text]),
    position = useRef(0),
    [, setHistoryVersion] = useState(0),
    toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profile = mode === "personalized" ? profiles.find((p) => p.id === profileId) : undefined;
  const engine = mode === "default" ? defaultEngine : profile?.kind === "reference" ? "neural" : personalEngine;
  const styleId = engine === "neural" ? neuralStyleId : presetStyleId;
  const notify = useCallback((value: string) => {
    setMessage(value);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setMessage(""), 5000);
  }, []);
  useEffect(() => {
    Promise.all([storage.profiles(), storage.documents()])
      .then(([p, d]) => {
        setProfiles(p);
        setDocuments(d.sort((a, b) => b.updatedAt - a.updatedAt));
      })
      .catch((e) =>
        setError(
          `Local storage is unavailable: ${e.message}. You can still generate and export.`,
        ),
      );
    return () => {
      controller.current?.abort();
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);
  const invalidateSelection = () => {
    selectionVersion.current++;
    controller.current?.abort();
    setBusy(false);
    setGenerated(null);
    setError("");
  };
  const setMode = (next: "default" | "personalized") => {
    invalidateSelection();
    setModeState(next);
    if (next === "default") {
      setProfileId("");
      setDefaultEngine("browser");
      setFallback(false);
    }
    setSidebar(false);
  };
  const choosePreset = (id: string) => {
    invalidateSelection();
    setModeState("default");
    setProfileId("");
    setDefaultEngine("browser");
    setPresetStyle(id);
    setFallback(false);
    setSidebar(false);
  };
  const deselectProfile = () => {
    invalidateSelection();
    setProfileId("");
    setPersonalEngine("browser");
    setFallback(false);
    notify("Handwriting sample deselected.");
  };
  const setEngine = (next: "browser" | "neural") => {
    invalidateSelection();
    if (mode === "default") setDefaultEngine(next);
    else setPersonalEngine(next);
    if (next === "neural" && neural.styles.length && !neural.styles.some(style => style.id === neuralStyleId))
      setNeuralStyleState(neural.styles[0].id);
  };
  const setNeuralStyle = (id: string) => {
    invalidateSelection();
    setNeuralStyleState(id);
  };
  const changeText = (next: string) => {
    setText(next);
    history.current = [
      ...history.current.slice(0, position.current + 1),
      next,
    ].slice(-120);
    position.current = history.current.length - 1;
    setHistoryVersion((v) => v + 1);
  };
  const undo = (direction: number) => {
    position.current = Math.max(
      0,
      Math.min(history.current.length - 1, position.current + direction),
    );
    setText(history.current[position.current]);
    setHistoryVersion((v) => v + 1);
  };
  const requestKey = JSON.stringify({

    text,
    settings,
    styleId,
    seed,
    mode,
    engine,
    profileId,
    profileRevision: profile?.updatedAt || profile?.createdAt,
    fallback,
  });
  const [renderKey, setRenderKey] = useState("");
  const stale = renderKey !== requestKey;
  const create = async (newSeed = seed) => {
    if (busy) return;
    setBusy(true);
    setError("");
    const run = new AbortController();
    const version = selectionVersion.current;
    controller.current = run;
    try {
      const onlyUploaded = mode === 'personalized' && profile?.wordSamples?.length && !uploadCoverage(text, profile).missing.length;
      if (engine === "neural" && !neural.ready && !onlyUploaded)
        throw new Error(
          mode === "personalized" && profile?.kind === "reference"
            ? "New or unmatched words require the local neural service. Start it and click Check local neural service, or correct the uploaded labels if those words are already in your note. Saved matching words can render without synthesis."
            : "The local neural engine is unavailable. Choose Default handwriting with Browser rendering to generate now.",
        );
      const result = await generate(
        {

          text,
          settings,
          styleId,
          seed: newSeed,
          mode,
          engine,
          profile,
          references:
            mode === 'personalized' && profile?.kind === "reference" ? profile.references : undefined,
          fallback,
        },
        run.signal,
      );
      if (run.signal.aborted || version !== selectionVersion.current) return;
      setGenerated(result);
      setRenderKey(
        JSON.stringify({

          text,
          settings,
          styleId,
          seed: newSeed,
          mode,
          engine,
          profileId,
          profileRevision: profile?.updatedAt || profile?.createdAt,
          fallback,
        }),
      );
      setSeed(newSeed);
      notify(
        result.missing.length
          ? mode === "personalized"
            ? "This is an advanced letter profile with missing letters. Upload your original handwriting image using Upload handwriting sample for automatic generation."
            : `Unsupported characters: ${result.missing.join(" ")}. Choose another preset or edit the text.`
          : `${result.pages.length} actual handwritten page${result.pages.length > 1 ? "s" : ""} generated.`,
      );
    } catch (e) {
      if (!run.signal.aborted && version === selectionVersion.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (controller.current === run) setBusy(false);
    }
  };
  const connect = async (activate = true) => {
    const context = selectionVersion.current;
    const connection = ++connectionVersion.current;
    setConnecting(true);
    setError("");
    try {
      const response = await fetch("http://127.0.0.1:8000/health", {
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok)
        throw new Error("The local service did not respond successfully.");
      const status = (await response.json()) as NeuralStatus;
      if (connection === connectionVersion.current) setNeural(status);
      if (context === selectionVersion.current && connection === connectionVersion.current) {
        if (status.ready) {
          if (activate) {
            invalidateSelection();
            if (mode === "default") setDefaultEngine("neural");
            else setPersonalEngine("neural");
            if (status.styles.length && !status.styles.some(style => style.id === neuralStyleId))
              setNeuralStyleState(status.styles[0].id);
          }
          notify(activate ? "Verified local neural engine connected. Neural generation is now selected." : "Handwriting sample selected. Matching uploaded words are ready to reuse.");
        } else notify(status.reason);
      }
    } catch {
      if (connection === connectionVersion.current) setNeural({
        ready: false,
        reason:
          "Could not connect to 127.0.0.1:8000. Start the optional local service, or keep using browser rendering.",
        styles: [],
      });
      if (context === selectionVersion.current && connection === connectionVersion.current) notify("Neural engine unavailable. Browser rendering remains available.");
    } finally {
      if (connection === connectionVersion.current) setConnecting(false);
    }
  };
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings((current) => ({ ...current, [key]: value }));
  const save = async (quiet = false) => {
    try {
      const value: WritingDocument = {

        id: documentId || crypto.randomUUID(),
        name: name.trim() || "Untitled document",
        text,
        settings,
        styleId,
        engine,
        fallback,
        profileId: mode === "personalized" ? profileId : undefined,
        seed,
        updatedAt: Date.now(),
        version: 1,
      };
      await storage.saveDocument(value);
      setDocumentId(value.id);
      setDocuments((previous) => [
        value,
        ...previous.filter((d) => d.id !== value.id),
      ]);
      if (!quiet) notify("Document saved on this device.");
    } catch (e) {
      setError(String(e));
    }
  };
  useEffect(() => {
    if (!documentId) return;
    const timer = setTimeout(() => void save(true), 900);
    return () => clearTimeout(timer);
  }, [requestKey, name, documentId]);
  const chooseProfile = async (p: Profile) => {
    invalidateSelection();
    setProfileId(p.id);
    setModeState("personalized");
    setFallback(false);
    setSidebar(false);
    if (p.kind === "reference") {
      setPersonalEngine("neural");
      if (!neural.ready) await connect(false);
      else if (p.automaticSample) notify("Sample ready. Type your text and generate handwriting.");
    } else {
      setPersonalEngine("browser");
      notify("Your extracted glyphs are selected. Browser personalization is active.");
    }
  };
  const saveProfile = async (p: Profile) => {
    const context = selectionVersion.current;
    await storage.saveProfile(p);
    setProfiles((previous) => [
      p,
      ...previous.filter((item) => item.id !== p.id),
    ]);
    if (context === selectionVersion.current) await chooseProfile(p);
  };
  const updateProfile = (p: Profile) => {
    setProfiles(previous => previous.map(item => item.id === p.id ? p : item));
    void storage.saveProfile(p).catch(e => setError(`Could not save word labels: ${String(e)}`));
  };
  const openDocument = (d: WritingDocument) => {
    if (documentId === d.id) return;
    invalidateSelection();
    setDocumentId(d.id);
    setName(d.name);
    changeText(d.text);
    setSettings(d.settings);
    setSeed(d.seed);
    if (d.engine === "neural") setNeuralStyleState(d.styleId);
    else setPresetStyle(d.styleId);
    setGenerated(null);
    if (d.profileId) {
      const p = profiles.find((p) => p.id === d.profileId);
      if (p) chooseProfile(p);
      else {
        setModeState("default");
        setProfileId("");
        setDefaultEngine("browser");
        notify(
          "The saved personal profile is unavailable. Choose a style before generating.",
        );
      }
    } else {
      setModeState("default");
      setProfileId("");
      setDefaultEngine(d.engine || "browser");
    }
    setFallback(d.fallback || false);
    setSidebar(false);
  };
  const exportFile = async (format: "pdf" | "png" | "all") => {
    if (!generated) return;
    setExporting(true);
    setError("");
    try {
      const blob =
        format === "pdf"
          ? await exportPDF(generated)
          : format === "png"
            ? await exportPNG(
                generated,
                Math.min(exportPage, generated.pages.length - 1),
              )
            : await exportAllPNG(generated);
      download(
        blob,
        `${name.replace(/[<>:"/\\|?*]/g, "-").slice(0, 80) || "InkForge"}.${format === "all" ? "zip" : format}`,
      );
      notify("Your handwritten file is ready; download started.");
      setExportOpen(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setExporting(false);
    }
  };
  return {

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
  };
}
