import type { Box } from "../types";
export function canvas(width: number, height: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}
export function toBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    c.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image encoding failed."))),
      "image/png",
    ),
  );
}
export async function loadImage(blob: Blob) {
  if (blob.size > 25 * 1024 * 1024)
    throw new Error("Use an image smaller than 25 MiB.");
  let image: ImageBitmap;
  try {
    image = await createImageBitmap(blob, { imageOrientation: "from-image" });
  } catch {
    throw new Error("This file is not a readable image. Use PNG or JPG.");
  }
  if (image.width * image.height > 40_000_000) {
    image.close();
    throw new Error("Resize this image below 40 megapixels.");
  }
  const factor = Math.min(1, 2600 / Math.max(image.width, image.height)),
    c = canvas(image.width * factor, image.height * factor),
    ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(image, 0, 0, c.width, c.height);
  image.close();
  return c;
}
export function grayscale(data: Uint8ClampedArray) {
  const gray = new Uint8Array(data.length / 4);
  for (let i = 0; i < gray.length; i++) {
    const a = data[i * 4 + 3] / 255;
    gray[i] =
      (data[i * 4] * 0.2126 +
        data[i * 4 + 1] * 0.7152 +
        data[i * 4 + 2] * 0.0722) *
        a +
      255 * (1 - a);
  }
  return gray;
}
export function clampBox(b: Box, w: number, h: number): Box {
  const x = Math.max(0, Math.min(w - 1, Math.round(b.x))),
    y = Math.max(0, Math.min(h - 1, Math.round(b.y)));
  return {
    x,
    y,
    width: Math.max(1, Math.min(w - x, Math.round(b.width))),
    height: Math.max(1, Math.min(h - y, Math.round(b.height))),
  };
}
export function foreground(c: HTMLCanvasElement, threshold: number) {
  const gray = grayscale(
    c.getContext("2d")!.getImageData(0, 0, c.width, c.height).data,
  );
  const mask = new Uint8Array(gray.length);
  for (let i = 0; i < gray.length; i++) mask[i] = gray[i] < threshold ? 1 : 0;
  return { gray, mask };
}
export function bounds(mask: Uint8Array, w: number, h: number): Box | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (mask[y * w + x]) {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return x1 < 0
    ? null
    : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
export async function decodeInk(url: string) {
  if (
    !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(url) ||
    url.length > 1_000_000
  )
    throw new Error("Invalid or oversized glyph PNG.");
  const blob = await (await fetch(url)).blob(),
    bitmap = await createImageBitmap(blob);
  if (bitmap.width * bitmap.height > 1_000_000) {
    bitmap.close();
    throw new Error("Glyph dimensions exceed the limit.");
  }
  return bitmap;
}
