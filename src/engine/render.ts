import type { GeneratedDocument, PagePlan } from "../types";
import { canvas, decodeInk, toBlob } from "./image";
import { styles } from "./styles";
const assets = new Map<string, Promise<ImageBitmap>>();
function ink(url: string) {
  if (!assets.has(url)) {
    if (assets.size > 600) {
      for (const value of assets.values()) void value.then((b) => b.close());
      assets.clear();
    }
    assets.set(url, decodeInk(url));
  }
  return assets.get(url)!;
}
export async function renderPage(
  doc: GeneratedDocument,
  index: number,
  scale = 1,
) {
  const page: PagePlan = doc.pages[index],
    s = doc.request.settings,
    c = canvas(page.width * scale, page.height * scale),
    ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  ctx.fillStyle = s.paper === "ivory" ? "#f7f1e3" : "#ffffff";
  ctx.fillRect(0, 0, page.width, page.height);
  ctx.strokeStyle = "#8aadc63a";
  ctx.fillStyle = "#8aadc67a";
  ctx.lineWidth = 0.6;
  if (s.paper === "ruled")
    for (
      let y = page.baseline + 3;
      y < page.height - 20;
      y += page.lineHeight
    ) {
      ctx.beginPath();
      ctx.moveTo(25, y);
      ctx.lineTo(page.width - 25, y);
      ctx.stroke();
    }
  if (s.paper === "grid") {
    for (let x = 20; x < page.width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, page.height);
      ctx.stroke();
    }
    for (let y = 20; y < page.height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(page.width, y);
      ctx.stroke();
    }
  }
  if (s.paper === "dotted")
    for (let y = 24; y < page.height; y += 21)
      for (let x = 24; x < page.width; x += 21) {
        ctx.beginPath();
        ctx.arc(x, y, 0.65, 0, Math.PI * 2);
        ctx.fill();
      }
  const family =
    styles.find((style) => style.id === doc.request.styleId)?.family ||
    styles[0].family;
  const colored = async (url: string) => {
    const image = await ink(url),
      mask = canvas(image.width, image.height),
      mctx = mask.getContext("2d")!;
    mctx.drawImage(image, 0, 0);
    mctx.globalCompositeOperation = "source-in";
    mctx.fillStyle = s.ink;
    mctx.fillRect(0, 0, mask.width, mask.height);
    return mask;
  };
  for (const item of page.items) {
    ctx.save();
    ctx.translate(item.x, item.y);
    ctx.rotate(item.rotation);
    ctx.transform(
      item.scale,
      0,
      Math.tan((s.slant * Math.PI) / 180),
      item.scale,
      0,
      0,
    );
    ctx.globalAlpha = item.opacity;
    ctx.fillStyle = s.ink;
    ctx.font = `${s.size}px "${family}"`;
    ctx.letterSpacing = `${s.letterSpacing}px`;
    if (item.image) {
      const image = await colored(item.image);
      const em = item.imageEm ?? 64;
      ctx.drawImage(image, 0, -s.size * (item.imageBaseline ?? 51.2) / em, item.width / item.scale, s.size * (item.imageHeight ?? 64) / em);
    } else if (item.glyphs) {
      const profile = doc.request.profile!,
        factor = s.size / profile.em;
      for (const piece of item.glyphs) {
        const image = await colored(piece.glyph.ink);
        ctx.drawImage(
          image,
          piece.x,
          -piece.glyph.baseline * factor,
          piece.glyph.width * factor,
          piece.glyph.height * factor,
        );
      }
      if (doc.request.fallback) {
        const keys = Object.keys(profile.glyphs)
          .filter((k) => profile.glyphs[k].length)
          .sort((a, b) => b.length - a.length);
        let x = 0;
        for (let i = 0; i < item.text.length; ) {
          const key = keys.find((k) => item.text.startsWith(k, i));
          if (key) {
            const match = item.glyphs.find((p) => Math.abs(p.x - x) < 0.01);
            x +=
              (match?.glyph.advance || profile.glyphs[key][0].advance) *
                factor +
              s.letterSpacing;
            i += key.length;
          } else {
            ctx.fillText(item.text[i], x, 0);
            x += ctx.measureText(item.text[i]).width;
            i++;
          }
        }
      }
    } else ctx.fillText(item.text, 0, 0);
    ctx.restore();
  }
  return c;
}
export async function exportPDF(doc: GeneratedDocument) {
  if (doc.missing.length && !doc.request.fallback)
    throw new Error(
      "Add samples for the missing characters or explicitly enable preset fallback before exporting.",
    );
  const { jsPDF } = await import("jspdf"),
    first = doc.pages[0];
  const pdf = new jsPDF({
    unit: "px",
    format: [first.width, first.height],
    hotfixes: ["px_scaling"],
    compress: true,
  });
  for (let i = 0; i < doc.pages.length; i++) {
    if (i) pdf.addPage([first.width, first.height]);
    const page = await renderPage(doc, i, 300 / 96);
    pdf.addImage(
      page.toDataURL("image/png"),
      "PNG",
      0,
      0,
      first.width,
      first.height,
      undefined,
      "FAST",
    );
  }
  pdf.setProperties({
    title: "InkForge handwritten document",
    creator: "InkForge AI",
  });
  return pdf.output("blob");
}
export async function exportPNG(doc: GeneratedDocument, index: number) {
  if (doc.missing.length && !doc.request.fallback)
    throw new Error(
      "Resolve missing characters or enable the labeled preset fallback first.",
    );
  return toBlob(await renderPage(doc, index, 300 / 96));
}
export async function exportAllPNG(doc: GeneratedDocument) {
  const { zipSync } = await import("fflate"),
    files: Record<string, Uint8Array> = {};
  for (let i = 0; i < doc.pages.length; i++)
    files[`page-${String(i + 1).padStart(3, "0")}.png`] = new Uint8Array(
      await (await exportPNG(doc, i)).arrayBuffer(),
    );
  return new Blob([zipSync(files, { level: 0 }).slice().buffer], {
    type: "application/zip",
  });
}
export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
