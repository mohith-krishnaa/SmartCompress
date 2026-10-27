import React, { useEffect, useMemo, useState } from "react";
import { FileDropzone } from "../components/FileDropzone";
import { Button } from "../components/Button";
import { ThemeModeSwitch } from "../components/ThemeModeSwitch";
import { Badge } from "../components/Badge";
import { Input } from "../components/Input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/Select";
import { FileText, ShieldCheck, Zap, ArrowDownToLine, RefreshCw, CheckCircle2, AlertCircle, LockKeyhole, Gauge, ScanLine, Image as ImageIcon, FileArchive, RotateCw, Scissors, Hash, Combine, Split, Trash2, ArrowUpDown } from "lucide-react";
import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";
import { jsPDF } from "jspdf";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.mjs";
import JSZip from "jszip";
import styles from "./_index.module.css";

// PDF.js requires an explicit worker URL in production browsers.
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`;

type Result = { blob: Blob; name: string; originalBytes: number; outputBytes: number; savedPercent: number; targetKB: number; reached: boolean; note: string; targetRelevant?: boolean };

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function HomePage() {
  const [toolMode, setToolMode] = useState<"pdf" | "image">("pdf");
  const [pdfAction, setPdfAction] = useState<"compress" | "rotate" | "extract" | "number" | "merge" | "split" | "imagesToPdf" | "pdfToImages" | "deletePages" | "reorderPages" | "watermark">("compress");
  const [rotation, setRotation] = useState("90");
  const [pageRange, setPageRange] = useState("1-3");
  const [pageOrder, setPageOrder] = useState("3,1,2");
  const [pageThumbs, setPageThumbs] = useState<{ page: number; src: string }[]>([]);
  const [dragPage, setDragPage] = useState<number | null>(null);
  const [markedPages, setMarkedPages] = useState<number[]>([]);
  const [downloadName, setDownloadName] = useState("");
  const [watermarkText, setWatermarkText] = useState("CONFIDENTIAL");
  const [watermarkOpacity, setWatermarkOpacity] = useState("0.22");
  const [file, setFile] = useState<File | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [target, setTarget] = useState("500");
  const [unit, setUnit] = useState("KB");
  const [mode, setMode] = useState("balanced");
  const [imageFormat, setImageFormat] = useState("image/jpeg");
  const [imageMaxWidth, setImageMaxWidth] = useState("1600");
  const [imageMaxHeight, setImageMaxHeight] = useState("1600");
  const [preset, setPreset] = useState("custom");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<Result | null>(null);
  const targetBytes = useMemo(() => Math.max(1, Number(target) || 1) * (unit === "MB" ? 1024 * 1024 : 1024), [target, unit]);

  useEffect(() => {
    let cancelled = false;
    async function renderThumbnails() {
      if (!file || toolMode !== "pdf" || !["reorderPages", "deletePages"].includes(pdfAction)) { setPageThumbs([]); setMarkedPages([]); return; }
      try {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true, useWorkerFetch: false, isEvalSupported: false } as any).promise;
        const thumbs: { page: number; src: string }[] = [];
        for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNo);
          const viewport = page.getViewport({ scale: 0.32 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
          const ctx = canvas.getContext("2d", { alpha: false });
          if (!ctx) continue;
          ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
          await page.render({ canvasContext: ctx, canvas, viewport, background: "#ffffff" } as any).promise;
          thumbs.push({ page: pageNo, src: canvas.toDataURL("image/jpeg", 0.72) });
          canvas.width = 1; canvas.height = 1;
        }
        if (!cancelled) {
          setPageThumbs(thumbs);
          setPageOrder(thumbs.map(t => t.page).join(","));
          setMarkedPages([]);
          setPageRange("");
        }
      } catch { if (!cancelled) setPageThumbs([]); }
    }
    void renderThumbnails();
    return () => { cancelled = true; };
  }, [file, toolMode, pdfAction]);

  function moveThumbnail(fromPage: number, toPage: number) {
    const order = pageOrder.split(",").map(v => Number(v.trim())).filter(Number.isFinite);
    const from = order.indexOf(fromPage), to = order.indexOf(toPage);
    if (from < 0 || to < 0 || from === to) return;
    order.splice(to, 0, order.splice(from, 1)[0]);
    setPageOrder(order.join(","));
  }

  function toggleMarkedPage(pageNo: number) {
    const next = markedPages.includes(pageNo) ? markedPages.filter(n => n !== pageNo) : [...markedPages, pageNo].sort((a, b) => a - b);
    setMarkedPages(next);
    setPageRange(next.join(","));
  }

  const chooseFile = (files: File[]) => {
    const picked = files[0];
    if (!picked) return;
    const imageInput = toolMode === "image" || (toolMode === "pdf" && pdfAction === "imagesToPdf");
    if (files.some(f => imageInput ? !f.type.startsWith("image/") : f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf"))) { setError(imageInput ? "Choose image files such as JPG, PNG or WebP." : "Choose PDF files only."); return; }
    if (files.some(f => f.size > 40 * 1024 * 1024)) { setError("Each file must be smaller than 40 MB."); return; }
    if (pdfAction === "merge" && files.length < 2) { setError("Select at least two PDF files to merge."); return; }
    setSelectedFiles(files);
    setFile(picked);
    setResult(null);
    setError("");
    setProgress("");
  };

  async function compressPdf() {
    if (!file) return;
    setBusy(true); setError(""); setResult(null);
    try {
      if (toolMode === "image") {
        if (selectedFiles.length > 1) {
          const zip = new JSZip();
          let totalOutputBytes = 0;
          let totalInputBytes = 0;
          let compressedCount = 0;
          let allTargetsReached = true;
          for (let index = 0; index < selectedFiles.length; index++) {
            const imageFile = selectedFiles[index];
            totalInputBytes += imageFile.size;
            setProgress(`Compressing image ${index + 1} of ${selectedFiles.length}…`);
            const objectUrl = URL.createObjectURL(imageFile);
            try {
              const image = new Image();
              await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(`Could not open ${imageFile.name}. Try a JPG, PNG or WebP image.`)); image.src = objectUrl; });
              const maxW = Math.max(1, Number(imageMaxWidth) || 1600);
              const maxH = Math.max(1, Number(imageMaxHeight) || 1600);
              const baseScale = Math.min(1, maxW / image.naturalWidth, maxH / image.naturalHeight);
              const qualities = imageFormat === "image/png" ? [1] : (mode === "strong" ? [0.62, 0.48, 0.36, 0.28] : [0.84, 0.72, 0.60, 0.48]);
              const scales = mode === "strong" ? [1, 0.86, 0.72, 0.60] : [1, 0.92, 0.84, 0.76];
              let bestBlob: Blob | null = null;
              for (let attempt = 0; attempt < qualities.length; attempt++) {
                const scale = baseScale * scales[attempt];
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
                canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
                const ctx = canvas.getContext("2d", { alpha: imageFormat !== "image/jpeg" });
                if (!ctx) throw new Error(`Could not prepare ${imageFile.name} for compression.`);
                if (imageFormat === "image/jpeg") { ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
                ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
                const candidate = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error(`Could not export ${imageFile.name}.`)), imageFormat, qualities[attempt]));
                canvas.width = 1; canvas.height = 1;
                if (!bestBlob || (candidate.size < bestBlob.size && candidate.size < imageFile.size)) bestBlob = candidate;
                if (candidate.size <= targetBytes) { bestBlob = candidate; break; }
              }
              if (!bestBlob) throw new Error(`Could not compress ${imageFile.name}.`);
              const blob = bestBlob;
              const ext = imageFormat === "image/jpeg" ? "jpg" : imageFormat === "image/png" ? "png" : "webp";
              const baseName = imageFile.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]/g, "-") || `image-${index + 1}`;
              zip.file(`${String(index + 1).padStart(2, "0")}-${baseName}-compressed.${ext}`, blob);
              totalOutputBytes += blob.size;
              if (blob.size < imageFile.size) compressedCount++;
              if (blob.size > targetBytes) allTargetsReached = false;
            } finally { URL.revokeObjectURL(objectUrl); }
          }
          setProgress("Packing compressed images into ZIP…");
          const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
          setResult({ blob, name: "compressed-images.zip", originalBytes: totalInputBytes, outputBytes: blob.size, savedPercent: Math.max(0, (totalInputBytes - blob.size) / totalInputBytes * 100), targetKB: targetBytes / 1024, reached: allTargetsReached, note: `Processed ${selectedFiles.length} images · ${compressedCount} individual files became smaller · ${imageFormat.split("/")[1].toUpperCase()} output`, targetRelevant: false });
          return;
        }
        setProgress("Loading image…");
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        try {
          await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("This image could not be opened. Try a JPG, PNG or WebP file.")); image.src = objectUrl; });
          const originalWidth = image.naturalWidth;
          const originalHeight = image.naturalHeight;
          const maxW = Math.max(1, Number(imageMaxWidth) || 1600);
          const maxH = Math.max(1, Number(imageMaxHeight) || 1600);
          const baseScale = Math.min(1, maxW / originalWidth, maxH / originalHeight);
          const qualities = imageFormat === "image/png" ? [1, 1, 1, 1, 1] : (mode === "strong" ? [0.72, 0.58, 0.46, 0.34, 0.26] : [0.86, 0.76, 0.66, 0.56, 0.46]);
          const scales = mode === "strong" ? [1, 0.88, 0.76, 0.64, 0.52] : [1, 0.92, 0.84, 0.76, 0.68];
          let bestBlob: Blob | null = null;
          let bestWidth = Math.max(1, Math.round(originalWidth * baseScale));
          let bestHeight = Math.max(1, Math.round(originalHeight * baseScale));
          let hitTarget = false;
          for (let i = 0; i < qualities.length; i++) {
            setProgress(`Optimizing image · pass ${i + 1} of ${qualities.length}`);
            const scale = baseScale * scales[i];
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(originalWidth * scale));
            canvas.height = Math.max(1, Math.round(originalHeight * scale));
            const ctx = canvas.getContext("2d", { alpha: imageFormat === "image/png" });
            if (!ctx) throw new Error("Your browser could not prepare this image.");
            if (imageFormat === "image/jpeg") { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height); }
            ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
            const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error("Image export failed. Try a different output format.")), imageFormat, qualities[i]));
            if (!bestBlob || (blob.size < bestBlob.size && blob.size < file.size)) { bestBlob = blob; bestWidth = canvas.width; bestHeight = canvas.height; }
            if (blob.size <= targetBytes) { bestBlob = blob; bestWidth = canvas.width; bestHeight = canvas.height; hitTarget = true; break; }
            canvas.width = 1; canvas.height = 1;
          }
          if (!bestBlob || bestBlob.size >= file.size) {
            setError("The output was not smaller than the original. Try JPEG or WebP, or reduce the dimensions. PNG files with simple graphics may already be optimized.");
            return;
          }
          const ext = imageFormat === "image/jpeg" ? "jpg" : imageFormat === "image/png" ? "png" : "webp";
          setResult({ blob: bestBlob, name: file.name.replace(/\.[^.]+$/, "") + `-compressed.${ext}`, originalBytes: file.size, outputBytes: bestBlob.size, savedPercent: Math.max(0, (file.size - bestBlob.size) / file.size * 100), targetKB: targetBytes / 1024, reached: hitTarget || bestBlob.size <= targetBytes, note: `${originalWidth}×${originalHeight} → ${bestWidth}×${bestHeight} · ${ext.toUpperCase()}` });
          return;
        } finally { URL.revokeObjectURL(objectUrl); }
      }
      if (toolMode === "pdf" && pdfAction !== "compress") {
        setProgress("Reading PDF pages…");
        if (pdfAction === "imagesToPdf") {
          if (selectedFiles.length < 1) throw new Error("Choose one or more images to convert.");
          const outputPdf = new jsPDF({ unit: "pt", format: "a4", compress: true });
          for (let i = 0; i < selectedFiles.length; i++) {
            const imageFile = selectedFiles[i];
            setProgress(`Converting image ${i + 1} of ${selectedFiles.length}…`);
            const image = new Image();
            const url = URL.createObjectURL(imageFile);
            try {
              await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error(`Could not open image: ${imageFile.name}`)); image.src = url; });
              const canvas = document.createElement("canvas");
              canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
              const context = canvas.getContext("2d");
              if (!context) throw new Error("Your browser could not prepare an image canvas.");
              context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0);
              const data = canvas.toDataURL("image/jpeg", 0.92);
              const maxWidth = 595.28, maxHeight = 841.89, scale = Math.min(maxWidth / canvas.width, maxHeight / canvas.height, 1);
              const width = canvas.width * scale, height = canvas.height * scale;
              if (i > 0) outputPdf.addPage("a4", "portrait");
              outputPdf.addImage(data, "JPEG", (maxWidth - width) / 2, (maxHeight - height) / 2, width, height, undefined, "MEDIUM");
              canvas.width = 1; canvas.height = 1;
            } finally { URL.revokeObjectURL(url); }
          }
          const blob = outputPdf.output("blob");
          const totalBytes = selectedFiles.reduce((sum, f) => sum + f.size, 0);
          setResult({ blob, name: "images-to-pdf.pdf", originalBytes: totalBytes, outputBytes: blob.size, savedPercent: (totalBytes - blob.size) / totalBytes * 100, targetKB: targetBytes / 1024, reached: blob.size <= targetBytes, note: `Converted ${selectedFiles.length} images into a ${selectedFiles.length}-page PDF`, targetRelevant: false });
          return;
        }
        if (pdfAction === "pdfToImages") {
          const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true, useWorkerFetch: false, isEvalSupported: false } as any);
          const pdf = await loadingTask.promise;
          const zip = new JSZip();
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            setProgress(`Exporting page ${pageNum} of ${pdf.numPages} as PNG…`);
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.6 });
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.floor(viewport.width)); canvas.height = Math.max(1, Math.floor(viewport.height));
            const context = canvas.getContext("2d", { alpha: false });
            if (!context) throw new Error("Your browser could not prepare a page preview.");
            context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: context, canvas, viewport, background: "#ffffff" } as any).promise;
            const png = await new Promise<Blob>((resolve, reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error(`Could not export page ${pageNum}.`)), "image/png"));
            zip.file(`page-${String(pageNum).padStart(3, "0")}.png`, png);
            canvas.width = 1; canvas.height = 1;
          }
          const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
          setResult({ blob, name: "pdf-pages-png.zip", originalBytes: file.size, outputBytes: blob.size, savedPercent: (file.size - blob.size) / file.size * 100, targetKB: targetBytes / 1024, reached: blob.size <= targetBytes, note: `Exported ${pdf.numPages} PDF pages as PNG images in a ZIP`, targetRelevant: false });
          return;
        }
        if (pdfAction === "merge") {
          if (selectedFiles.length < 2) throw new Error("Choose at least two PDF files to merge.");
          const merged = await PDFDocument.create();
          let totalPages = 0;
          for (let i = 0; i < selectedFiles.length; i++) {
            setProgress(`Merging document ${i + 1} of ${selectedFiles.length}…`);
            const source = await PDFDocument.load(await selectedFiles[i].arrayBuffer());
            const copied = await merged.copyPages(source, source.getPageIndices());
            copied.forEach(page => merged.addPage(page));
            totalPages += copied.length;
          }
          const bytes = await merged.save({ useObjectStreams: true });
          const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
          const totalBytes = selectedFiles.reduce((sum, f) => sum + f.size, 0);
          setResult({ blob, name: "merged-document.pdf", originalBytes: totalBytes, outputBytes: blob.size, savedPercent: (totalBytes - blob.size) / totalBytes * 100, targetKB: targetBytes / 1024, reached: blob.size <= targetBytes, note: `Merged ${selectedFiles.length} PDFs · ${totalPages} total pages`, targetRelevant: false });
          return;
        }
        const doc = await PDFDocument.load(await file.arrayBuffer());
        const pages = doc.getPages();
        if (pdfAction === "rotate") {
          const turn = Number(rotation);
          pages.forEach(page => page.setRotation(degrees(((page.getRotation().angle + turn) % 360 + 360) % 360)));
        } else if (pdfAction === "extract" || pdfAction === "split" || pdfAction === "deletePages" || pdfAction === "reorderPages") {
          const indices = new Set<number>();
          for (const part of (pdfAction === "reorderPages" ? [] : pageRange.split(","))) {
            const trimmed = part.trim();
            if (!trimmed) continue;
            const match = trimmed.match(/^(\d+)(?:\s*-\s*(\d+))?$/);
            if (!match) throw new Error("Enter pages like 1-3, 5, 8-10.");
            const start = Number(match[1]), end = Number(match[2] || match[1]);
            if (start < 1 || end < start || end > pages.length) throw new Error(`Page range ${trimmed} is invalid. This PDF has ${pages.length} pages.`);
            for (let n = start; n <= end; n++) indices.add(n - 1);
          }
          if (pdfAction !== "reorderPages" && !indices.size) throw new Error("Enter at least one page or range, such as 1-3, 5.");
          let selected = [...indices].sort((a, b) => a - b);
          if (pdfAction === "reorderPages") {
            const order = pageOrder.split(",").map(v => Number(v.trim()));
            if (order.length !== pages.length || order.some(n => !Number.isInteger(n) || n < 1 || n > pages.length) || new Set(order).size !== order.length) throw new Error(`Enter every page number exactly once in desired order. This PDF has ${pages.length} pages; e.g. 3,1,2.`);
            selected = order.map(n => n - 1);
          }
          if (pdfAction === "deletePages") {
            const deleted = new Set(selected);
            selected = pages.map((_, i) => i).filter(i => !deleted.has(i));
            if (!selected.length) throw new Error("You cannot delete every page. Keep at least one page.");
          }
          const newDoc = await PDFDocument.create();
          const copied = await newDoc.copyPages(doc, selected);
          copied.forEach(page => newDoc.addPage(page));
          const bytes = await newDoc.save();
          const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
          const suffix = pdfAction === "deletePages" ? "-edited.pdf" : pdfAction === "reorderPages" ? "-reordered.pdf" : pdfAction === "split" ? "-split.pdf" : "-pages.pdf";
          setResult({ blob, name: file.name.replace(/\.pdf$/i, "") + suffix, originalBytes: file.size, outputBytes: blob.size, savedPercent: (file.size - blob.size) / file.size * 100, targetKB: targetBytes / 1024, reached: blob.size <= targetBytes, note: pdfAction === "deletePages" ? `Removed ${indices.size} pages; kept ${selected.length} of ${pages.length}` : pdfAction === "reorderPages" ? `Reordered all ${pages.length} pages` : `${pdfAction === "split" ? "Split selection" : "Extracted"} ${selected.length} of ${pages.length} pages into one PDF`, targetRelevant: false });
          return;
        } else if (pdfAction === "number") {
          const font = await doc.embedFont("Helvetica");
          pages.forEach((page, index) => {
            const { width } = page.getSize();
            page.drawText(String(index + 1), { x: width / 2 - 4, y: 18, size: 10, font, opacity: 0.7 });
          });
        } else if (pdfAction === "watermark") {
          const text = watermarkText.trim();
          if (!text) throw new Error("Enter the watermark text first.");
          const font = await doc.embedFont(StandardFonts.HelveticaBold);
          const opacity = Math.max(0.05, Math.min(0.8, Number(watermarkOpacity) || 0.22));
          pages.forEach(page => {
            const { width, height } = page.getSize();
            const size = Math.min(48, Math.max(18, width / Math.max(5, text.length * 0.58)));
            const textWidth = font.widthOfTextAtSize(text, size);
            page.drawText(text, { x: Math.max(8, (width - textWidth) / 2), y: height / 2, size, font, color: rgb(0.45, 0.45, 0.45), opacity, rotate: degrees(-35) });
          });
        }
        const bytes = await doc.save({ useObjectStreams: true });
        const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
        const suffix = pdfAction === "rotate" ? "-rotated.pdf" : pdfAction === "watermark" ? "-watermarked.pdf" : "-numbered.pdf";
        setResult({ blob, name: file.name.replace(/\.pdf$/i, "") + suffix, originalBytes: file.size, outputBytes: blob.size, savedPercent: (file.size - blob.size) / file.size * 100, targetKB: targetBytes / 1024, reached: blob.size <= targetBytes, note: pdfAction === "rotate" ? `Rotated ${pages.length} pages by ${rotation}°` : pdfAction === "watermark" ? `Added a text watermark to ${pages.length} pages` : `Added page numbers to ${pages.length} pages`, targetRelevant: false });
        return;
      }
      const input = new Uint8Array(await file.arrayBuffer());
      setProgress("Inspecting PDF…");
      // First try a structural rewrite. This is lossless and preserves selectable text.
      const sourceDoc = await PDFDocument.load(input, { ignoreEncryption: false });
      const pageCount = sourceDoc.getPageCount();
      const rewritten = await sourceDoc.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
      let output = new Blob([rewritten as BlobPart], { type: "application/pdf" });
      let note = "Lossless PDF rewrite";
      if (mode === "lossless") {
        if (output.size >= file.size) {
          setError("This PDF is already compact or uses compression that cannot be improved by a lossless rewrite. Try Balanced or Strong mode; those rebuild pages as images and may reduce text sharpness or remove selectable text.");
          return;
        }
      } else if (output.size > targetBytes || output.size >= file.size) {
        // Rasterize each page and rebuild at progressively lower image quality.
        // This can reduce image-heavy PDFs, but text may no longer be selectable.
        setProgress("Rendering pages for compression…");
        const loadingTask = pdfjsLib.getDocument({ data: input, disableWorker: true, useWorkerFetch: false, isEvalSupported: false } as any);
        const pdf = await loadingTask.promise;
        const qualitySteps = mode === "strong" ? [0.62, 0.48, 0.36, 0.28] : [0.78, 0.66, 0.54, 0.44];
        const scaleSteps = mode === "strong" ? [1.15, 0.95, 0.8, 0.68] : [1.35, 1.15, 1, 0.85];
        let best: Blob | null = null;
        for (let attempt = 0; attempt < qualitySteps.length; attempt++) {
          setProgress(`Optimizing pages · pass ${attempt + 1} of ${qualitySteps.length}`);
          const quality = qualitySteps[attempt];
          const scale = scaleSteps[attempt];
          let outPdf: jsPDF | null = null;
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const viewport = page.getViewport({ scale });
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.floor(viewport.width));
            canvas.height = Math.max(1, Math.floor(viewport.height));
            const context = canvas.getContext("2d", { alpha: false });
            if (!context) throw new Error("Your browser could not prepare a canvas for this PDF.");
            context.fillStyle = "#ffffff";
            context.fillRect(0, 0, canvas.width, canvas.height);
            await page.render({ canvasContext: context, canvas, viewport, background: "#ffffff" } as any).promise;
            const data = canvas.toDataURL("image/jpeg", quality);
            const pageWidth = page.view[2] - page.view[0];
            const pageHeight = page.view[3] - page.view[1];
            if (!outPdf) outPdf = new jsPDF({ orientation: pageWidth > pageHeight ? "landscape" : "portrait", unit: "pt", format: [pageWidth, pageHeight], compress: true });
            else outPdf.addPage([pageWidth, pageHeight], pageWidth > pageHeight ? "landscape" : "portrait");
            outPdf.addImage(data, "JPEG", 0, 0, pageWidth, pageHeight, undefined, "MEDIUM");
            canvas.width = 1; canvas.height = 1;
          }
          if (outPdf) {
            const blob = outPdf.output("blob");
            if (!best || blob.size < best.size) best = blob;
            if (blob.size <= targetBytes) break;
          }
        }
        if (best && best.size < output.size) {
          output = best;
          note = "Rasterized image-based compression";
        } else if (best && best.size < file.size) {
          output = best;
          note = "Rasterized image-based compression";
        }
      }
      if (output.size >= file.size) {
        setError("The optimized output was not smaller than the original, so we did not offer it as a compressed download. This PDF may already be optimized.");
        return;
      }
      const savedPercent = Math.max(0, ((file.size - output.size) / file.size) * 100);
      const reached = output.size <= targetBytes;
      setResult({ blob: output, name: file.name.replace(/\.pdf$/i, "") + "-compressed.pdf", originalBytes: file.size, outputBytes: output.size, savedPercent, targetKB: targetBytes / 1024, reached, note: note + (pageCount ? ` · ${pageCount} page${pageCount === 1 ? "" : "s"}` : "") });
      setProgress("");
    } catch (e: any) {
      setError(e?.message?.toLowerCase().includes("encrypt") ? "This PDF appears to be encrypted or password-protected. Remove the password first, then try again." : (e?.message || "Compression failed. The file may be damaged or unsupported."));
    } finally {
      setBusy(false);
      setProgress("");
    }
  }

  function downloadResult() {
    if (!result) return;
    const url = URL.createObjectURL(result.blob);
    const anchor = document.createElement("a");
    const extension = result.name.match(/\.[^.]+$/)?.[0] || "";
    const base = (downloadName.trim() || result.name.replace(/\.[^.]+$/, "")).replace(/[\\/:*?"<>|]/g, "-").replace(/\.+$/g, "").trim();
    anchor.href = url; anchor.download = (base || "smartcompress-output") + extension; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <a href="/" className={styles.brand} aria-label="SmartCompress home">
          <span className={styles.brandMark}><ScanLine size={21} strokeWidth={2.5} /></span>
          <span>smart<span className={styles.brandAccent}>compress</span><small>FILE TOOLS, WITHOUT THE FUSS</small></span>
        </a>
        <div className={styles.headerRight}>
          <span className={styles.privacyPill}><LockKeyhole size={13} /> Private by design</span>
          <ThemeModeSwitch />
        </div>
      </header>

      <section className={styles.hero}>
        <div className={styles.eyebrow}><span className={styles.liveDot} /> FILE TOOLKIT <span className={styles.eyebrowDivider}>/</span> FREE TO USE</div>
        <h1>Smaller files.<br /><span>Zero guesswork.</span></h1>
        <p className={styles.heroCopy}>Compress PDFs and images to fit upload limits, compare every byte, and download when you're ready. Files are processed locally in your browser.</p>
        <div className={styles.heroStats}>
          <div><Zap size={16} /><span>Target-size workflow</span></div>
          <div><ShieldCheck size={16} /><span>No account needed</span></div>
          <div><Gauge size={16} /><span>Measured results</span></div>
        </div>
      </section>

      <section className={styles.workspace} aria-label="File tools">
        <div className={styles.modeTabs} role="tablist" aria-label="Choose file type">
          <button type="button" role="tab" aria-selected={toolMode === "pdf"} className={toolMode === "pdf" ? styles.modeTabActive : styles.modeTab} onClick={() => { setToolMode("pdf"); setPdfAction("compress"); setFile(null); setResult(null); setError(""); }}> <FileText size={16} /> PDF tools</button>
          <button type="button" role="tab" aria-selected={toolMode === "image"} className={toolMode === "image" ? styles.modeTabActive : styles.modeTab} onClick={() => { setToolMode("image"); setFile(null); setResult(null); setError(""); }}> <ImageIcon size={16} /> Image compressor</button>
        </div>
        {toolMode === "pdf" && <div className={styles.actionGrid} aria-label="PDF actions">
          <button type="button" className={pdfAction === "compress" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("compress"); setResult(null); setError(""); }}><Zap size={16} /> Compress</button>
          <button type="button" className={pdfAction === "merge" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("merge"); setFile(null); setSelectedFiles([]); setResult(null); setError(""); }}><Combine size={16} /> Merge PDFs</button>
          <button type="button" className={pdfAction === "split" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("split"); setResult(null); setError(""); }}><Split size={16} /> Split pages</button>
          <button type="button" className={pdfAction === "deletePages" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("deletePages"); setResult(null); setError(""); }}><Trash2 size={16} /> Delete pages</button>
          <button type="button" className={pdfAction === "reorderPages" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("reorderPages"); setResult(null); setError(""); }}><ArrowUpDown size={16} /> Reorder pages</button>
          <button type="button" className={pdfAction === "rotate" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("rotate"); setResult(null); setError(""); }}><RotateCw size={16} /> Rotate</button>
          <button type="button" className={pdfAction === "extract" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("extract"); setResult(null); setError(""); }}><Scissors size={16} /> Extract pages</button>
          <button type="button" className={pdfAction === "number" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("number"); setResult(null); setError(""); }}><Hash size={16} /> Page numbers</button>
          <button type="button" className={pdfAction === "watermark" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("watermark"); setResult(null); setError(""); }}><ShieldCheck size={16} /> Watermark</button>
          <button type="button" className={pdfAction === "imagesToPdf" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("imagesToPdf"); setFile(null); setSelectedFiles([]); setResult(null); setError(""); }}><ImageIcon size={16} /> Images to PDF</button>
          <button type="button" className={pdfAction === "pdfToImages" ? styles.actionActive : styles.actionButton} onClick={() => { setPdfAction("pdfToImages"); setFile(null); setSelectedFiles([]); setResult(null); setError(""); }}><FileArchive size={16} /> PDF to PNG</button>
        </div>}
        <div className={styles.workspaceHead}>
          <div className={styles.stepTitle}><span className={styles.stepNumber}>01</span><div><h2>{pdfAction === "merge" && toolMode === "pdf" ? "Choose PDFs to merge" : pdfAction === "imagesToPdf" && toolMode === "pdf" ? "Choose images to convert" : `Choose your ${toolMode === "pdf" ? "PDF" : "image"}`}</h2><p>{pdfAction === "merge" && toolMode === "pdf" ? "Select two or more PDFs; files merge in the order selected." : pdfAction === "imagesToPdf" && toolMode === "pdf" ? "Select images in the order you want them to appear in the PDF." : toolMode === "image" || pdfAction === "compress" ? "Start with a file from your device." : "Choose a PDF to process in your browser."}</p></div></div>
          <Badge variant="secondary" className={styles.fileBadge}>{toolMode === "pdf" ? <><FileText size={13} /> PDF ONLY · MAX 40 MB</> : <><ImageIcon size={13} /> JPG · PNG · WEBP · MAX 40 MB</>}</Badge>
        </div>
        {!file || (toolMode === "pdf" && (pdfAction === "merge" || pdfAction === "imagesToPdf")) ? (
          <FileDropzone key={toolMode + pdfAction} accept={toolMode === "image" || pdfAction === "imagesToPdf" ? "image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" : ".pdf,application/pdf"} maxFiles={toolMode === "image" || (toolMode === "pdf" && (pdfAction === "merge" || pdfAction === "imagesToPdf")) ? 10 : 1} maxSize={40 * 1024 * 1024} onFilesSelected={chooseFile} icon={<span className={styles.uploadIcon}>{toolMode === "image" || pdfAction === "imagesToPdf" ? <ImageIcon size={30} /> : <FileText size={30} />}</span>} title={<><strong>{toolMode === "image" ? "Choose images to compress" : pdfAction === "merge" && toolMode === "pdf" ? "Choose multiple PDFs" : pdfAction === "imagesToPdf" && toolMode === "pdf" ? "Choose multiple images" : `Drop your PDF here`}</strong><span>or browse files on your device</span></>} subtitle={<span className={styles.dropzoneHint}>{toolMode === "image" || pdfAction === "imagesToPdf" ? "JPG, PNG or WebP images" : "PDF documents"} · Up to 40 MB each · {toolMode === "image" || pdfAction === "merge" || pdfAction === "imagesToPdf" ? "Up to 10 files" : "One file at a time"}</span>} className={styles.dropzone} />
        ) : (
          <div className={styles.fileSelected}>
            <div className={styles.pdfIcon}><FileText size={24} /></div>
            <div className={styles.fileInfo}><strong>{toolMode === "image" && selectedFiles.length > 1 ? `${selectedFiles.length} images selected` : pdfAction === "merge" && toolMode === "pdf" ? `${selectedFiles.length} PDF files selected` : pdfAction === "imagesToPdf" && toolMode === "pdf" ? `${selectedFiles.length} images selected` : file.name}</strong><span>{(toolMode === "image" && selectedFiles.length > 1 || (pdfAction === "merge" || pdfAction === "imagesToPdf") && toolMode === "pdf") ? formatBytes(selectedFiles.reduce((sum, f) => sum + f.size, 0)) + " total" : formatBytes(file.size) + (toolMode === "pdf" ? " · PDF document" : " · Image file")}</span>{(toolMode === "image" && selectedFiles.length > 1 || (pdfAction === "merge" || pdfAction === "imagesToPdf") && toolMode === "pdf") && <small>{selectedFiles.map(f => f.name).join(" · ")}</small>}</div>
            <Button variant="ghost" size="sm" onClick={() => { setFile(null); setResult(null); setError(""); }} disabled={busy}>Replace</Button>
          </div>
        )}

        {toolMode === "image" && <div className={styles.imageOptions}>
          <div className={styles.settingBlock}><label className={styles.fieldLabel}>OUTPUT FORMAT</label><Select value={imageFormat} onValueChange={setImageFormat} disabled={busy}><SelectTrigger className={styles.modeSelect}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="image/jpeg">JPEG · best for photos</SelectItem><SelectItem value="image/webp">WebP · smaller modern format</SelectItem><SelectItem value="image/png">PNG · transparency</SelectItem></SelectContent></Select></div>
          <div className={styles.dimensions}><div className={styles.settingBlock}><label className={styles.fieldLabel}>MAX WIDTH (PX)</label><Input type="number" min="1" max="12000" value={imageMaxWidth} onChange={e => setImageMaxWidth(e.target.value)} disabled={busy} /></div><div className={styles.settingBlock}><label className={styles.fieldLabel}>MAX HEIGHT (PX)</label><Input type="number" min="1" max="12000" value={imageMaxHeight} onChange={e => setImageMaxHeight(e.target.value)} disabled={busy} /></div></div>
        </div>}
        {toolMode === "pdf" && pdfAction === "rotate" && <div className={styles.actionOptions}><label className={styles.fieldLabel}>ROTATION</label><Select value={rotation} onValueChange={setRotation}><SelectTrigger className={styles.modeSelect}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="90">90° clockwise</SelectItem><SelectItem value="180">180°</SelectItem><SelectItem value="270">270° clockwise</SelectItem></SelectContent></Select></div>}
        {toolMode === "pdf" && pdfAction === "watermark" && <div className={styles.actionOptions}><label className={styles.fieldLabel}>WATERMARK TEXT</label><Input value={watermarkText} onChange={e => setWatermarkText(e.target.value)} maxLength={80} placeholder="Example: CONFIDENTIAL" /><label className={styles.fieldLabel} style={{ marginTop: 14 }}>OPACITY (0.05–0.8)</label><Input type="number" min="0.05" max="0.8" step="0.05" value={watermarkOpacity} onChange={e => setWatermarkOpacity(e.target.value)} /><p className={styles.helperText}>Adds a diagonal text watermark to every page. This does not encrypt or password-protect the PDF.</p></div>}
        {toolMode === "pdf" && ["extract", "split", "deletePages"].includes(pdfAction) && <div className={styles.actionOptions}><label className={styles.fieldLabel}>{pdfAction === "deletePages" ? "PAGES TO DELETE" : "PAGE NUMBERS OR RANGES"}</label><Input value={pageRange} onChange={e => setPageRange(e.target.value)} placeholder="Example: 1-3, 5, 8-10" /><p className={styles.helperText}>{pdfAction === "deletePages" ? "These pages will be removed; all others will be kept." : "Creates one PDF containing the selected pages. Use page numbers such as 1-3, 5."}</p></div>}
        {toolMode === "pdf" && pdfAction === "reorderPages" && <div className={styles.actionOptions}><label className={styles.fieldLabel}>NEW PAGE ORDER</label><Input value={pageOrder} onChange={e => setPageOrder(e.target.value)} placeholder="Drag thumbnails below or enter 3,1,2" /><p className={styles.helperText}>Drag page cards to reorder them, or enter every page number once in the desired order.</p></div>}
        {toolMode === "pdf" && ["reorderPages", "deletePages"].includes(pdfAction) && file && <div className={styles.pageEditor}>
          <div className={styles.pageEditorHead}><strong>{pdfAction === "deletePages" ? "Select pages to remove" : "Drag to reorder pages"}</strong><span>{pageThumbs.length ? `${pageThumbs.length} pages` : "Loading previews…"}</span></div>
          {pdfAction === "deletePages" && <p className={styles.helperText}>Tap a page to mark it for deletion. Marked pages are highlighted and listed in the page field above.</p>}
          <div className={styles.pageThumbGrid}>
            {(pdfAction === "reorderPages" ? pageOrder.split(",").map(v => pageThumbs.find(t => t.page === Number(v.trim()))).filter((t): t is { page: number; src: string } => Boolean(t)) : pageThumbs).map((thumb, index) => <button type="button" key={thumb.page} className={`${styles.pageThumb} ${markedPages.includes(thumb.page) && pdfAction === "deletePages" ? styles.pageThumbMarked : ""}`} draggable={pdfAction === "reorderPages"} onDragStart={() => setDragPage(thumb.page)} onDragOver={e => { if (pdfAction === "reorderPages") e.preventDefault(); }} onDrop={e => { e.preventDefault(); if (dragPage !== null) moveThumbnail(dragPage, thumb.page); setDragPage(null); }} onDragEnd={() => setDragPage(null)} onClick={() => { if (pdfAction === "deletePages") toggleMarkedPage(thumb.page); }} aria-label={pdfAction === "deletePages" ? `Toggle page ${thumb.page} for deletion` : `Page ${thumb.page}, position ${index + 1}`}>
              <img src={thumb.src} alt={`Preview of page ${thumb.page}`} loading="lazy" />
              <span>{pdfAction === "reorderPages" ? `Position ${index + 1} · Page ${thumb.page}` : `Page ${thumb.page}${markedPages.includes(thumb.page) ? " · DELETE" : ""}`}</span>
            </button>)}
          </div>
        </div>}
        <div className={styles.settingsGrid} style={{ display: toolMode === "pdf" && pdfAction !== "compress" ? "none" : undefined }}>
          <div className={styles.settingBlock}>
            <label className={styles.fieldLabel}>TARGET FILE SIZE <span>Optional goal</span></label>
            <div className={styles.targetInput}>
              <Input type="number" min="1" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target file size" disabled={busy} />
              <Select value={unit} onValueChange={setUnit} disabled={busy}>
                <SelectTrigger className={styles.unitSelect}><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="KB">KB</SelectItem><SelectItem value="MB">MB</SelectItem></SelectContent>
              </Select>
            </div>
            <p className={styles.helperText}>We’ll aim for this size, but some files cannot reach every target without quality loss.</p>
          </div>
          <div className={styles.settingBlock}>
            <label className={styles.fieldLabel}>COMPRESSION MODE</label>
            <Select value={mode} onValueChange={setMode} disabled={busy}>
              <SelectTrigger className={styles.modeSelect}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="balanced">Balanced · recommended</SelectItem>
                <SelectItem value="strong">Strong · smaller file</SelectItem>
                <SelectItem value="lossless">Lossless · preserve text</SelectItem>
              </SelectContent>
            </Select>
            <p className={styles.helperText}>{mode === "lossless" ? "Preserves selectable text. May not reduce size." : "May rasterize pages, making text unselectable and fine print less sharp."}</p>
          </div>
        </div>

        <div className={styles.qualityNotice}><AlertCircle size={16} /><p><strong>Know the trade-off.</strong> {toolMode === "pdf" ? (pdfAction === "compress" ? "Balanced and Strong modes can rebuild pages as images. That may remove selectable text, links, forms and accessibility data." : "PDF changes create a new file. Check page orientation, order and numbering before using it officially.") : "JPEG does not preserve transparency. PNG can be larger than the original, and aggressive compression or resizing can reduce detail."} Keep your original file.</p></div>
        <Button className={styles.compressButton} size="lg" onClick={compressPdf} disabled={!file || busy || Number(target) <= 0}>
          {busy ? <><RefreshCw size={17} className={styles.spin} /> Processing…</> : <><Zap size={17} /> {toolMode === "image" ? (selectedFiles.length > 1 ? `Compress ${selectedFiles.length} images` : "Compress image") : pdfAction === "compress" ? "Compress PDF" : pdfAction === "rotate" ? "Rotate PDF" : pdfAction === "extract" ? "Extract pages" : pdfAction === "split" ? "Create selected PDF" : pdfAction === "merge" ? "Merge PDFs" : pdfAction === "imagesToPdf" ? "Convert images to PDF" : pdfAction === "pdfToImages" ? "Convert PDF to PNGs" : pdfAction === "deletePages" ? "Delete selected pages" : pdfAction === "reorderPages" ? "Reorder PDF pages" : pdfAction === "watermark" ? "Watermark PDF" : "Add page numbers"} <span>→</span></>}
        </Button>
        {busy && <div className={styles.progressLine} role="status"><span className={styles.progressBar} />{progress || "Preparing your file…"}</div>}
        {error && <div className={styles.errorBox} role="alert"><AlertCircle size={18} /><span>{error}</span></div>}
      </section>

      {result && (
        <section className={styles.results} aria-live="polite">
          <div className={styles.resultHeading}><span className={styles.resultCheck}><CheckCircle2 size={20} /></span><div><h2>Your file is ready</h2><p>{result.note}</p></div></div>
          <div className={styles.comparison}>
            <div className={styles.sizeCard}><span>ORIGINAL SIZE</span><strong>{formatBytes(result.originalBytes)}</strong><div className={styles.sizeBar}><i style={{ width: "100%" }} /></div></div>
            <div className={styles.sizeArrow}>→</div>
            <div className={styles.sizeCard + " " + styles.outputCard}><span>NEW SIZE</span><strong>{formatBytes(result.outputBytes)}</strong><div className={styles.sizeBar}><i style={{ width: `${Math.max(4, result.outputBytes / result.originalBytes * 100)}%` }} /></div></div>
          </div>
          <div className={styles.resultMetrics}><div><strong>{result.savedPercent.toFixed(1)}%</strong><span>{result.targetRelevant === false ? "size change" : "smaller"}</span></div><div><strong>{formatBytes(Math.abs(result.originalBytes - result.outputBytes))}</strong><span>{result.targetRelevant === false ? "size difference" : "space saved"}</span></div>{result.targetRelevant !== false && <div><strong>{result.reached ? "Reached" : "Not reached"}</strong><span>target size</span></div>}</div>
          {result.targetRelevant !== false && <div className={result.reached ? styles.targetStatus : styles.targetWarning}>{result.reached ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{result.reached ? "Your output is within the requested size." : `Output is still above the target (${formatBytes(targetBytes)}). Try Strong mode or a larger target.`}</div>}
          <label className={styles.fieldLabel} htmlFor="download-filename">OUTPUT FILE NAME <span>Extension added automatically</span></label>
          <Input id="download-filename" value={downloadName} onChange={e => setDownloadName(e.target.value)} placeholder={result.name.replace(/\.[^.]+$/, "")} />
          <p className={styles.helperText}>Keep the suggested name or type your own. The correct extension is preserved.</p>
          <Button size="lg" className={styles.downloadButton} onClick={downloadResult}><ArrowDownToLine size={18} /> Download {result.name.endsWith(".zip") ? (result.name.includes("compressed-images") ? "image ZIP" : "PNG ZIP") : result.name.endsWith(".pdf") ? "PDF" : "compressed image"}</Button>
          <p className={styles.outputName}>Suggested: {result.name}</p>
        </section>
      )}

      <section className={styles.toolsNext}>
        <div className={styles.toolsNextTitle}><span>FILE SIZE HELPER</span><h2>Meet upload requirements with fewer retries.</h2></div>
        <div className={styles.presetBox}><label className={styles.fieldLabel}>QUICK SIZE PRESETS <span>Examples only — verify your portal's latest rules</span></label><Select value={preset} onValueChange={v => { setPreset(v); if (v !== "custom") { setToolMode("image"); setFile(null); setResult(null); setError(""); } if (v === "photo") { setTarget("50"); setUnit("KB"); setImageMaxWidth("600"); setImageMaxHeight("600"); } else if (v === "signature") { setTarget("20"); setUnit("KB"); setImageMaxWidth("300"); setImageMaxHeight("150"); } else if (v === "document") { setTarget("200"); setUnit("KB"); setImageMaxWidth("1600"); setImageMaxHeight("1600"); } }}><SelectTrigger className={styles.modeSelect}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="custom">Custom target</SelectItem><SelectItem value="photo">Photo · 50 KB max (example)</SelectItem><SelectItem value="signature">Signature · 20 KB max (example)</SelectItem><SelectItem value="document">Document image · 200 KB max (example)</SelectItem></SelectContent></Select><p className={styles.helperText}>These are convenience examples, not official government requirements. Always check the specific application notice for size, format and dimensions.</p></div>
        <div className={styles.nextTool}><span className={styles.nextIcon}><Combine size={19} /></span><div><strong>Merge PDFs and batch processing</strong><p>Combine documents and process multiple files together</p></div><Badge variant="outline">Next phase</Badge></div>
      </section>

      <footer className={styles.footer}><span>SMARTCOMPRESS <i>©</i> 2026</span><span><LockKeyhole size={12} /> Files are processed in your browser. Nothing is uploaded to our server.</span></footer>
    </main>
  );
}
