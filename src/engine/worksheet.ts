import type { Box, Glyph } from "../types";
import { bounds, canvas, clampBox, foreground } from "./image";
export const SHEET = {
  width: 1000,
  height: 1414,
  version: "IF-G1",
  columns: 8,
  rows: 10,
  left: 60,
  top: 160,
  cellWidth: 110,
  cellHeight: 114,
};
export const characters = [
  ...Array.from({ length: 94 }, (_, i) => String.fromCharCode(i + 33)),
  ..."etaoinshrdlucmfwypvbgkqjxz".repeat(2),
];
export const markers = [
  { x: 36, y: 36 },
  { x: 964, y: 36 },
  { x: 964, y: 1378 },
  { x: 36, y: 1378 },
];
export function cells(page: number) {
  return characters
    .slice(page * 80, (page + 1) * 80)
    .map((character, i) => ({
      character,
      x: SHEET.left + (i % 8) * SHEET.cellWidth,
      y: SHEET.top + Math.floor(i / 8) * SHEET.cellHeight,
      width: SHEET.cellWidth,
      height: SHEET.cellHeight,
    }));
}
export function worksheetCanvas(page: number) {
  const c = canvas(2000, 2828),
    ctx = c.getContext("2d")!;
  ctx.scale(2, 2);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 1000, 1414);
  ctx.fillStyle = "#111";
  for (const p of markers) ctx.fillRect(p.x - 10, p.y - 10, 20, 20);
  ctx.fillStyle = "#202333";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText("InkForge / Your handwriting, one letter at a time.", 60, 87);
  ctx.font = "11px sans-serif";
  ctx.fillText(
    "Write each labeled character once in its box with a dark pen. Keep every stroke inside.",
    60,
    111,
  );
  ctx.fillText(
    "Use the dashed baseline. Print at 100%. Photograph the whole page with all four black markers visible.",
    60,
    132,
  );
  for (const cell of cells(page)) {
    ctx.strokeStyle = "#bdcbd0";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(cell.x + 3, cell.y + 23, cell.width - 6, cell.height - 28);
    ctx.fillStyle = "#777";
    ctx.font = "13px sans-serif";
    ctx.fillText(cell.character, cell.x + 8, cell.y + 16);
    ctx.strokeStyle = "#c6dbe0";
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(cell.x + 10, cell.y + 83);
    ctx.lineTo(cell.x + cell.width - 10, cell.y + 83);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = "#777";
  ctx.font = "10px sans-serif";
  ctx.fillText(
    `${SHEET.version} / Page ${page + 1} of 2 / A4 / Personal glyph rendering, not neural training`,
    60,
    1351,
  );
  return c;
}
export async function worksheetPDF() {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ unit: "mm", format: "a4", compress: true });
  for (let page = 0; page < 2; page++) {
    if (page) pdf.addPage();
    pdf.addImage(
      worksheetCanvas(page).toDataURL("image/png"),
      "PNG",
      0,
      0,
      210,
      297,
      undefined,
      "FAST",
    );
  }
  return pdf.output("blob");
}
export interface Point {
  x: number;
  y: number;
}
export function homography(from: Point[], to: Point[]) {
  if (from.length !== 4 || to.length !== 4)
    throw new Error("Four corresponding registration points are required.");
  const matrix: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = from[i],
      u = to[i].x,
      v = to[i].y;
    matrix.push(
      [x, y, 1, 0, 0, 0, -u * x, -u * y, u],
      [0, 0, 0, x, y, 1, -v * x, -v * y, v],
    );
  }
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++)
      if (Math.abs(matrix[r][col]) > Math.abs(matrix[pivot][col])) pivot = r;
    if (Math.abs(matrix[pivot][col]) < 1e-9)
      throw new Error(
        "Registration points form a degenerate page. Select four distinct corners.",
      );
    [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
    const divisor = matrix[col][col];
    for (let j = col; j < 9; j++) matrix[col][j] /= divisor;
    for (let r = 0; r < 8; r++)
      if (r !== col) {
        const factor = matrix[r][col];
        for (let j = col; j < 9; j++) matrix[r][j] -= factor * matrix[col][j];
      }
  }
  return matrix.map((row) => row[8]);
}
export function mapPoint(h: number[], p: Point) {
  const d = h[6] * p.x + h[7] * p.y + 1;
  return {
    x: (h[0] * p.x + h[1] * p.y + h[2]) / d,
    y: (h[3] * p.x + h[4] * p.y + h[5]) / d,
  };
}
export function warp(source: HTMLCanvasElement, points: Point[]) {
  const h = homography(markers, points),
    input = source
      .getContext("2d")!
      .getImageData(0, 0, source.width, source.height),
    target = canvas(SHEET.width, SHEET.height),
    ctx = target.getContext("2d")!,
    output = ctx.createImageData(target.width, target.height);
  for (let y = 0; y < target.height; y++)
    for (let x = 0; x < target.width; x++) {
      const p = mapPoint(h, { x, y }),
        dest = (y * target.width + x) * 4;
      if (
        p.x < 0 ||
        p.y < 0 ||
        p.x >= source.width - 1 ||
        p.y >= source.height - 1
      ) {
        output.data.fill(255, dest, dest + 4);
        continue;
      }
      const x0 = Math.floor(p.x),
        y0 = Math.floor(p.y),
        fx = p.x - x0,
        fy = p.y - y0,
        i = (y0 * source.width + x0) * 4;
      for (let c = 0; c < 3; c++)
        output.data[dest + c] =
          input.data[i + c] * (1 - fx) * (1 - fy) +
          input.data[i + 4 + c] * fx * (1 - fy) +
          input.data[i + source.width * 4 + c] * (1 - fx) * fy +
          input.data[i + (source.width + 1) * 4 + c] * fx * fy;
      output.data[dest + 3] = 255;
    }
  ctx.putImageData(output, 0, 0);
  return target;
}
export function detectMarkers(image: HTMLCanvasElement): Point[] | null {
  const scale = Math.min(1, 900 / Math.max(image.width, image.height)),
    small = canvas(image.width * scale, image.height * scale);
  small.getContext("2d")!.drawImage(image, 0, 0, small.width, small.height);
  const { mask } = foreground(small, 85),
    w = small.width,
    h = small.height,
    visited = new Uint8Array(mask.length),
    candidates: Point[] = [];
  for (let i = 0; i < mask.length; i++)
    if (mask[i] && !visited[i]) {
      const stack = [i];
      visited[i] = 1;
      let count = 0,
        x0 = w,
        y0 = h,
        x1 = 0,
        y1 = 0;
      while (stack.length) {
        const at = stack.pop()!,
          x = at % w,
          y = Math.floor(at / w);
        count++;
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        for (const n of [
          x > 0 ? at - 1 : -1,
          x < w - 1 ? at + 1 : -1,
          y > 0 ? at - w : -1,
          y < h - 1 ? at + w : -1,
        ])
          if (n >= 0 && mask[n] && !visited[n]) {
            visited[n] = 1;
            stack.push(n);
          }
      }
      const width = x1 - x0 + 1,
        height = y1 - y0 + 1;
      if (
        count > 12 &&
        count < w * h * 0.012 &&
        width / height > 0.5 &&
        width / height < 2 &&
        count / (width * height) > 0.67
      )
        candidates.push({ x: (x0 + x1) / 2 / scale, y: (y0 + y1) / 2 / scale });
    }
  const corners = [
    { x: 0, y: 0 },
    { x: image.width, y: 0 },
    { x: image.width, y: image.height },
    { x: 0, y: image.height },
  ];
  const chosen = corners.map(
    (corner) =>
      candidates
        .slice()
        .sort(
          (a, b) =>
            Math.hypot(a.x - corner.x, a.y - corner.y) -
            Math.hypot(b.x - corner.x, b.y - corner.y),
        )[0],
  );
  if (chosen.some((p) => !p) || new Set(chosen).size !== 4) return null;
  if (
    Math.hypot(chosen[0].x - chosen[2].x, chosen[0].y - chosen[2].y) <
    Math.hypot(image.width, image.height) * 0.65
  )
    return null;
  if (
    chosen.some(
      (p, i) =>
        Math.hypot(p.x - corners[i].x, p.y - corners[i].y) >
        Math.hypot(image.width, image.height) * 0.25,
    )
  )
    return null;
  return chosen;
}
export function extractGlyph(
  source: HTMLCanvasElement,
  region: Box,
  character: string,
  baseline: number,
  threshold: number,
): Glyph | null {
  const b = clampBox(region, source.width, source.height),
    crop = canvas(b.width, b.height);
  crop
    .getContext("2d")!
    .drawImage(source, b.x, b.y, b.width, b.height, 0, 0, b.width, b.height);
  const { gray, mask } = foreground(crop, threshold),
    box = bounds(mask, crop.width, crop.height);
  if (!box) return null;
  let count = 0;
  for (const value of mask) count += value;
  if (count < 3) return null;
  const glyph = canvas(box.width, box.height),
    ctx = glyph.getContext("2d")!,
    data = ctx.createImageData(box.width, box.height);
  for (let y = 0; y < box.height; y++)
    for (let x = 0; x < box.width; x++) {
      const value = gray[(y + box.y) * crop.width + x + box.x],
        i = (y * box.width + x) * 4;
      data.data[i + 3] =
        value < threshold ? Math.min(255, (255 - value) * 1.2) : 0;
    }
  ctx.putImageData(data, 0, 0);
  const warnings: string[] = [];
  if (
    box.x < 2 ||
    box.y < 2 ||
    box.x + box.width >= crop.width - 2 ||
    box.y + box.height >= crop.height - 2
  )
    warnings.push("Possible clipped stroke");
  if (count / mask.length > 0.55) warnings.push("High ink coverage");
  if (box.height < 5) warnings.push("Very small sample");
  return {
    id: crypto.randomUUID(),
    character,
    width: box.width,
    height: box.height,
    baseline: baseline - b.y - box.y,
    advance: box.width + 7,
    ink: glyph.toDataURL("image/png"),
    warnings,
  };
}
export function extractSheet(
  aligned: HTMLCanvasElement,
  page: number,
  threshold: number,
) {
  return cells(page)
    .map((cell) =>
      extractGlyph(
        aligned,
        {
          x: cell.x + 11,
          y: cell.y + 29,
          width: cell.width - 22,
          height: cell.height - 39,
        },
        cell.character,
        cell.y + 83,
        threshold,
      ),
    )
    .filter((g): g is Glyph => !!g);
}
