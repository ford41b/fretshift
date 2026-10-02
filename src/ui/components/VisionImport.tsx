import { GlassSwitch } from "./MobileGlass";
import { useEffect, useRef, useState } from "react";
import { Camera, RotateCw, ScanLine, Upload, RefreshCcw, X } from "lucide-react";
import { cloudConfig } from "../../cloud/client";
import { useCloudStore } from "../../cloud/store";
import type { Song } from "../../schema/song.v1";
import { extractPdfText, pageHasChordContent, pdfPagesToSongs, suggestPdfSplits, findChordReviewItems } from "../../io/pdfText";
import {
  preprocessImage,
  tileCrops,
  type CropEdges,
  type PreparedVisionPage,
  scannedPdfPages,
  recognizeVisionTextPage,
} from "../../vision";
import { ErrorNotice } from "./Common";
import "../../vision/vision.css";

type Props = {
  disabled?: boolean;
  initialPdf?: File | null;
  onDrafts?: (songs: Song[]) => void;
  onDraft: (song: Song | null) => void;
};
type Page = {
  file: File;
  preview: string;
  rotation: 0 | 90 | 180 | 270;
  crop: CropEdges;
  dense: boolean;
  prepared?: PreparedVisionPage[];
  originalText: string;
  text: string;
  method: "text" | "ocr";
  status: "pending" | "working" | "done" | "failed";
  error?: string;
};
const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function VisionImport({ disabled = false, initialPdf, onDraft, onDrafts }: Props) {
  const config = cloudConfig();
  const configUrl = config?.url;
  const configKey = config?.key;
  const session = useCloudStore((state) => state.session);
  const [providerConfigured, setProviderConfigured] = useState<boolean | null>(null);
  const [pages, setPages] = useState<Page[]>([]);
  const [source, setSource] = useState<"photo" | "pdf-scan">("photo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hint, setHint] = useState("");
  const [ready, setReady] = useState(false);
  const [draftCount, setDraftCount] = useState(0);
  const [forceVisual, setForceVisual] = useState(false);
  const [splitBefore, setSplitBefore] = useState<Set<number>>(new Set());
  const splitTouched = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const initial = useRef<File | null>(null);
  const previews = useRef<string[]>([]);

  useEffect(() => () => {
    generation.current++;
    controller.current?.abort();
    initial.current = null;
    previews.current.forEach(URL.revokeObjectURL);
  }, []);
  useEffect(() => {
    if (!configUrl || !configKey) return;
    const abort = new AbortController();
    void fetch(`${configUrl}/functions/v1/vision-import`, {
      method: "GET", headers: { apikey: configKey }, signal: abort.signal,
    }).then(async (response) => {
      if (!response.ok) return;
      const body = await response.json() as { providerConfigured?: unknown };
      if (typeof body.providerConfigured === "boolean") setProviderConfigured(body.providerConfigured);
    }).catch(() => undefined);
    return () => abort.abort();
  }, [configUrl, configKey]);

  function invalidate() {
    generation.current++;
    controller.current?.abort();
    controller.current = null;
    setBusy(false);
    setReady(false);
    setDraftCount(0);
    setError("");
    setHint("");
    setHint("");
    onDraft(null);
    onDrafts?.([]);
  }
  function replace(next: Page[], kind: "photo" | "pdf-scan") {
    invalidate();
    previews.current.forEach(URL.revokeObjectURL);
    previews.current = next.map((page) => page.preview);
    setPages(next);
    setSplitBefore(new Set());
    splitTouched.current = false;
    setSource(kind);
  }
  function photo(file: File): Page {
    return { file, preview: URL.createObjectURL(file), rotation: 0, crop: { top: 0, right: 0, bottom: 0, left: 0 }, dense: false,
      text: "", originalText: "", method: "ocr", status: "pending" };
  }
  async function selectFiles(files: File[], append = false) {
    if (!files.length) return;
    const run = ++generation.current;
    controller.current?.abort();
    setBusy(true);
    setError("");
    setHint("");
    setReady(false);
    onDraft(null);
    onDrafts?.([]);
    try {
      if (files.length === 1 && isPdf(files[0])) {
        if (append) throw new Error("Choose a PDF separately from your photos.");
        // Every page keeps its place, even when the text layer is empty or
        // contains only a page number. Never reject visual OCR on text alone.
        const textPages = await extractPdfText(new Uint8Array(await files[0].arrayBuffer()),
          { allowScannedPages: true });
        const rasters = await scannedPdfPages(files[0]);
        if (run !== generation.current) return;
        replace(rasters.map((file, index) => {
          const text = textPages[index]?.text ?? "";
          const method = !forceVisual && pageHasChordContent(text) ? "text" : "ocr";
          return { ...photo(file), text: method === "text" ? text : "",
            originalText: text, method, status: method === "text" ? "done" : "pending" };
        }), "pdf-scan");
      } else {
        if (files.some((file) => !file.type.startsWith("image/") && !/\.hei[cf]$/i.test(file.name)))
          throw new Error("Choose image files or one PDF.");
        if ((append ? pages.length : 0) + files.length > 10)
          throw new Error("Import up to 10 pages at once.");
        if (run !== generation.current) return;
        const next = files.map(photo);
        if (append) {
          setPages((current) => [...current, ...next]);
          previews.current.push(...next.map((p) => p.preview));
          setSource("photo");
        } else replace(next, "photo");
      }
    } catch (cause) {
      if (run === generation.current) setError(message(cause));
    } finally {
      if (run === generation.current) setBusy(false);
    }
  }
  useEffect(() => {
    if (initialPdf && initialPdf !== initial.current) {
      initial.current = initialPdf;
      void selectFiles([initialPdf]);
    }
    // Deliberately tied to the incoming file: edits do not re-import it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPdf]);

  function update(index: number, change: Partial<Page>) {
    invalidate();
    setPages((current) => current.map((page, n) => n === index ? { ...page, ...change } : page));
  }
  function setVisual(checked: boolean) {
    invalidate();
    setForceVisual(checked);
    setPages((current) => current.map((page) => {
      const method = checked ? "ocr" : pageHasChordContent(page.originalText) ? "text" : "ocr";
      return { ...page, method,
        text: method === "text" ? page.originalText : "",
        status: method === "text" ? "done" : "pending", prepared: undefined, error: undefined };
    }));
  }
  async function analyze() {
    if (busy || disabled || !pages.length) return;
    const run = ++generation.current;
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setReady(false);
    setDraftCount(0);
    setError("");
    setHint("");
    setHint("");
    onDraft(null);
    const working = pages.map((page) => ({ ...page }));
    const publish = () => { if (run === generation.current) setPages(working.map((page) => ({ ...page }))); };
    try {
      const needsOcr = working.some((page) => page.method === "ocr" && page.status !== "done");
      if (needsOcr && (!config || providerConfigured === false || !session))
        throw new Error(!config || providerConfigured === false
          ? "Visual OCR is not configured. You can still edit PDF text locally."
          : "Sign in under Account & sync to analyze images. PDF text remains local.");
      // Stage one renders the exact JPEG(s) that will be submitted. The user
      // can inspect crop / rotation / small chord suffixes BEFORE any OCR.
      if (working.some(page => page.method === "ocr" && page.status !== "done" && !page.prepared)) {
        for (const page of working) {
          if (page.method !== "ocr" || page.status === "done" || page.prepared) continue;
          if (abort.signal.aborted) return;
          page.status = "working"; page.error = undefined; publish();
          try {
            const areas = page.dense ? tileCrops(page.crop) : [page.crop];
            page.prepared = [];
            for (const crop of areas) {
              const prepared = await preprocessImage(page.file, { rotation: page.rotation, crop });
              if (abort.signal.aborted || run !== generation.current) return;
              page.prepared.push(prepared);
            }
            page.status = "pending";
          } catch (cause) {
            page.status = "failed";
            page.prepared = undefined;
            page.error = message(cause);
          }
          publish();
        }
        if (working.some(page => page.status === "failed"))
          setError("Some previews could not be prepared. Adjust those pages and retry; other pages are preserved.");
        else setHint("Inspect the exact processed preview(s) below, then choose Recognize prepared pages.");
        return;
      }
      for (let index = 0; index < working.length; index++) {
        const page = working[index];
        if (page.method === "text" || page.status === "done") continue;
        if (abort.signal.aborted) return;
        page.status = "working";
        page.error = undefined;
        publish();
        try {
          const texts: string[] = [];
          for (const prepared of page.prepared ?? []) {
            const recognized = await recognizeVisionTextPage(prepared, abort.signal);
            if (abort.signal.aborted || run !== generation.current) return;
            texts.push(recognized.text);
          }
          if (!texts.length) throw new Error("Prepare and inspect the processed preview before recognizing this page.");
          if (abort.signal.aborted || run !== generation.current) return;
          // Overlapping tiles intentionally preserve a little repeated context
          // for correction; do not silently deduplicate musical tokens.
          page.text = texts.join("\n\n[REVIEW TILE BOUNDARY]\n\n");
          page.status = "done";
        } catch (cause) {
          if (abort.signal.aborted || run !== generation.current) return;
          page.status = "failed";
          page.error = message(cause);
        }
        publish();
      }
      if (working.some((page) => page.status !== "done")) {
        setError("Some pages could not be read. Retry failed pages or edit their text below. Completed pages are preserved.");
        return;
      }
      // Overlapping image tiles can repeat music. Require the player to resolve
      // overlap manually; never turn repeated OCR into duplicate chord events.
      if (working.some(page => page.text.includes("[REVIEW TILE BOUNDARY]"))) {
        setError("Dense OCR tiles overlap. Remove the [REVIEW TILE BOUNDARY] marker and reconcile repeated lyrics/chords in extracted text before building a draft.");
        return;
      }
      // Only assemble from complete, ordered pages. Never silently skip a page.
      const reviewCount = working.reduce((n, page, index) => n + findChordReviewItems(page.text, index + 1).length, 0);
      if (reviewCount) {
        setError(`${reviewCount} chord-like token(s) need review. Correct them next to the source page, then rebuild. None were silently replaced.`);
        return;
      }
      const textPages = working.map((page, index) => ({ number: index + 1, text: page.text }));
      const boundaries = splitTouched.current ? splitBefore : suggestPdfSplits(textPages);
      const songs = pdfPagesToSongs(textPages, boundaries);
      for (const song of songs) {
        song.provenance = { ...song.provenance, source: source === "pdf-scan" && working.every((page) => page.method === "text") ? "pdf-text" : source,
          modelId: working.some((page) => page.method === "ocr") ? "ocr-space-engine-3" : undefined,
          processedAt: new Date().toISOString() };
      }
      if (run === generation.current) {
        setSplitBefore(boundaries);
        setDraftCount(songs.length);
        onDraft(songs[0]);
        onDrafts?.(songs);
        setReady(true);
      }
    } catch (cause) {
      if (run === generation.current && !abort.signal.aborted)
        setError(`${message(cause)} Edit the extracted text below and rebuild the draft, or retry individual pages.`);
    } finally {
      if (run === generation.current) { setBusy(false); controller.current = null; }
    }
  }
  return (
    <div className="vision-import">
      <div className="vision-workflow" aria-label="Import steps">Choose file → Check pages → Correct chords → Confirm timing → Save</div>
      {(!session || !config || providerConfigured === false) && <p role="status" className="vision-signin">Photo and visual PDF recognition requires signing in under Account & sync before choosing pages. Local PDF text works without an account.</p>}
      <div className="section-title">
        <div><ScanLine size={35} className="accent-text" /><h2>Smart photo & PDF import</h2></div>
        <div className="button-row vision-source-actions">
          <label className="button file-button"><Camera size={17} /> Take photo
            <input type="file" accept="image/*" capture="environment" disabled={disabled || busy || pages.length >= 10}
              aria-label="Take a photo of a chord sheet" onChange={(event) => {
                void selectFiles(Array.from(event.target.files ?? []), true); event.target.value = "";
              }} />
          </label>
          <label className="button file-button"><Upload size={17} /> Choose pages or PDF
            <input type="file" accept="image/*,.heic,.heif,.pdf,application/pdf" multiple disabled={disabled || busy}
              aria-label="Choose chart photos or a PDF" onChange={(event) => {
                void selectFiles(Array.from(event.target.files ?? [])); event.target.value = "";
              }} />
          </label>
        </div>
      </div>
      <p>PDF text is read on this device. Pages that cannot be recognized as chord charts can be analyzed visually, one page at a time. Photo pages are prepared locally, then sent temporarily to OCR; completed pages are kept if another page fails.</p>
      {source === "pdf-scan" && pages.length > 0 && <label className="vision-force">
        <GlassSwitch checked={forceVisual} disabled={busy} onChange={(e) => setVisual(e.target.checked)} />
        Force visual analysis of every PDF page (may use more OCR requests)
      </label>}
      {busy && <div role="status" className="vision-progress">Reading chart… {pages.filter((p) => p.status === "done").length} of {pages.length} pages complete
        <button type="button" onClick={() => { invalidate(); setPages((p) => p.map((page) => page.status === "working" ? { ...page, status: "pending" } : page)); }}> <X size={14} /> Cancel </button>
      </div>}
      {pages.length > 0 && <>
        <div className="vision-thumbs" aria-label="Page thumbnail strip">
          {pages.map((page, index) => <button key={page.preview} type="button" onClick={() => document.getElementById(`vision-page-${index}`)?.scrollIntoView({behavior:"smooth",block:"center"})}>
            <img src={page.preview} alt=""/><span>Page {index + 1}{page.method === "ocr" ? " · visual" : " · text"}</span>
          </button>)}
        </div>
        <p role="status">{pages.reduce((total,page,index) => total + findChordReviewItems(page.text,index+1).length,0)} chord-like items needing review</p>
        <div className="vision-pages" aria-label="Ordered page review">
          {pages.map((page, index) => <figure className="vision-page" key={page.preview} id={`vision-page-${index}`}>
            <div className="vision-page-frame vision-source-frame">
              <img src={page.preview} alt={`Original page ${index + 1}: ${page.file.name}`} />
              {page.method === "ocr" && <span className="vision-crop-rect" aria-hidden="true" style={{ top: `${page.crop.top * 100}%`,right: `${page.crop.right * 100}%`,bottom: `${page.crop.bottom * 100}%`,left: `${page.crop.left * 100}%` }}/>}
            </div>
            {page.prepared?.length ? <div className="vision-processed" aria-label={`Processed OCR preview, page ${index + 1}`}>
              <strong>Exact image{page.prepared.length > 1 ? " tiles" : ""} for OCR · inspect before sending</strong>
              {page.prepared.some(prepared => Math.max(prepared.width,prepared.height) < 1200) && <span className="vision-page-error">Fine details were reduced to meet the 1 MB OCR limit. Tighten the crop or enable dense overlapping tiles.</span>}
              {page.prepared.map((prepared,tile) => <img key={prepared.id} src={prepared.dataUrl} alt={`Actual processed page ${index+1}${page.prepared!.length>1?` tile ${tile+1}`:""}`} />)}
            </div> : <p className="muted">Preview shows the source and crop rectangle. Prepare the exact output before OCR.</p>}
            <figcaption><strong>Page {index + 1}</strong>
              <span>{page.status === "done" ? (page.method === "text" ? "Local PDF text" : "Visual OCR complete") : page.status === "working" ? "Analyzing…" : page.status === "failed" ? "Needs retry" : "Waiting for visual OCR"}</span>
              {page.error && <span role="alert" className="vision-page-error">{page.error}</span>}
              {page.status === "failed" && page.originalText.trim() && <button type="button" disabled={busy}
                onClick={() => update(index, { method: "text", text: page.originalText, status: "done", error: undefined })}>
                Use local PDF text instead (review chords manually)
              </button>}
              {source === "pdf-scan" && <label>Method
                <select disabled={busy} value={page.method} onChange={(event) => {
                  const method = event.target.value as Page["method"];
                  update(index, { method, text: method === "text" ? page.originalText : "", status: method === "text" ? "done" : "pending", prepared: undefined, error: undefined });
                }}><option value="text">Local text</option><option value="ocr">Visual OCR</option></select>
              </label>}
              {page.method === "ocr" && <button type="button" disabled={busy} onClick={() => update(index, { rotation: ((page.rotation + 90) % 360) as Page["rotation"], prepared: undefined, text: page.method === "ocr" ? "" : page.text, status: page.method === "ocr" ? "pending" : "done" })}><RotateCw size={15} /> Rotate</button>}
              {page.method === "ocr" && <><div className="vision-crop-fields" role="group" aria-label={`Independent crop edges, page ${index + 1}`}>
                {(["top", "right", "bottom", "left"] as const).map(edge => <label key={edge}>Crop {edge}: {Math.round(page.crop[edge] * 100)}%
                  <input type="range" min="0" max="40" value={Math.round(page.crop[edge] * 100)} disabled={busy}
                    onChange={event => update(index, { crop: {...page.crop, [edge]: Number(event.target.value) / 100}, prepared: undefined, text: page.method === "ocr" ? "" : page.text, status: page.method === "ocr" ? "pending" : "done", error: undefined })}/>
                </label>)}
              </div>
              <label className="vision-dense"><GlassSwitch checked={page.dense} disabled={busy} onChange={e => update(index,{dense:e.target.checked,prepared:undefined,text:page.method === "ocr" ? "" : page.text,status:page.method === "ocr" ? "pending" : "done",error:undefined})}/> Dense chart: overlapping, higher-detail image tiles</label></>}
              {findChordReviewItems(page.text,index+1).length > 0 && <div className="vision-review-items" role="status">
                <strong>{findChordReviewItems(page.text,index+1).length} items needing review</strong>
                {findChordReviewItems(page.text,index+1).map((item,i) => <div key={`${item.line}-${item.token}-${i}`}>
                  Line {item.line}: <code>{item.token}</code> — unrecognized chord-like token.
                  {item.suggestion && <button type="button" disabled={busy} onClick={() => {
                    const lines=page.text.split(/\r?\n/);
                    lines[item.line-1]=lines[item.line-1].replace(item.token,item.suggestion!);
                    update(index,{text:lines.join("\n"),status:"done",error:undefined});
                  }}>Could this be {item.suggestion}? Apply correction</button>}
                </div>)}
              </div>}
              <label>Extracted text (editable)<textarea className="vision-page-text" rows={5} spellCheck={false} disabled={busy}
                value={page.text} placeholder="OCR results appear here. You can also type the chords and lyrics manually."
                onChange={(event) => update(index, { text: event.target.value, status: event.target.value.trim() ? "done" : "pending", error: undefined })} /></label>
            </figcaption>
          </figure>)}
        </div>
        {pages.length > 1 && <div className="vision-splits">
          <strong>Song boundaries (editable)</strong>
          {pages.slice(1).map((page, index) => <label key={page.preview}>
            <GlassSwitch checked={splitBefore.has(index + 2)} disabled={busy}
              onChange={(event) => {
                invalidate(); splitTouched.current = true;
                setSplitBefore((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(index + 2); else next.delete(index + 2);
                  return next;
                });
              }} /> Start a new song on page {index + 2}
          </label>)}
        </div>}
        <div className="button-row">
          <button className="primary" disabled={disabled || busy} onClick={() => void analyze()}>
            <RefreshCcw size={17} /> {pages.some((p) => p.status === "failed") ? "Retry failed pages" : pages.some(p=>p.method === "ocr" && p.status !== "done" && !p.prepared) ? "Prepare exact OCR previews" : pages.some(p=>p.method === "ocr" && p.status !== "done") ? "Recognize prepared pages" : ready ? "Rebuild draft" : "Review extracted chords"}
          </button>
          {pages.some((p) => p.status === "failed") && <span className="muted">Successful pages will not be reprocessed.</span>}
        </div>
      </>}
      {ready && <div role="status" className="vision-confidence"><strong>{draftCount} {draftCount === 1 ? "draft" : "drafts"} ready for review</strong>
        <span>Confirm chord names, lyrics, key, capo and any uncertain pages before saving.</span></div>}
      {pages.some((p) => p.method === "ocr" && p.status !== "done") && (!session || !config || providerConfigured === false) &&
        <p className="muted">Visual OCR needs a signed-in account and configured OCR.space service. Local PDF text and manual correction remain available.</p>}
      {hint && <p role="status" className="vision-progress">{hint}</p>}
      <ErrorNotice error={error} />
    </div>
  );
}
