// Layered product-image compositor (canvas). Reproduces the KantoForge case
// mockup as a fast 2D composite instead of a 3D render:
//   background art (fills the case interior) → card (centred slot) → glass
//   overlay (fixed acrylic + reflections + watermark + branding, on top).
// All rectangles are stored as fractions of the canvas so they're resolution
// independent — dial them in once, reuse at any export size.

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't load an image."));
    img.src = src;
  });
}

// Draw an image "cover" (fill the rect, crop overflow) within a clip rect.
function drawCover(ctx, img, x, y, w, h, offX = 0, offY = 0, zoom = 1) {
  const ir = img.width / img.height;
  const rr = w / h;
  let dw;
  let dh;
  if (ir > rr) { dh = h * zoom; dw = dh * ir; } else { dw = w * zoom; dh = dw / ir; }
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, x + (w - dw) / 2 + offX * w, y + (h - dh) / 2 + offY * h, dw, dh);
  ctx.restore();
}

// Draw an image "contain" centred on (cx,cy) at a target width (height by aspect).
function drawCard(ctx, img, cx, cy, w) {
  const h = w * (img.height / img.width);
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
  return { w, h };
}

// spec: { size:{w,h}, bg, base, artSrc, cardSrc, overlaySrc,
//         interior:{x,y,w,h}, art:{offX,offY,zoom}, card:{cx,cy,w} }  (all fractions)
export async function composite(spec, canvas) {
  const c = canvas || document.createElement("canvas");
  c.width = spec.size.w;
  c.height = spec.size.h;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.fillStyle = spec.bg || "#f2f2f0";
  ctx.fillRect(0, 0, c.width, c.height);

  if (spec.base) ctx.drawImage(await loadImage(spec.base), 0, 0, c.width, c.height);

  const IN = spec.interior;
  if (spec.artSrc && IN) {
    const a = await loadImage(spec.artSrc);
    const art = spec.art || {};
    drawCover(ctx, a, IN.x * c.width, IN.y * c.height, IN.w * c.width, IN.h * c.height, art.offX || 0, art.offY || 0, art.zoom || 1);
  }

  if (spec.cardSrc && spec.card) {
    const cd = await loadImage(spec.cardSrc);
    drawCard(ctx, cd, spec.card.cx * c.width, spec.card.cy * c.height, spec.card.w * c.width);
  }

  if (spec.overlaySrc) ctx.drawImage(await loadImage(spec.overlaySrc), 0, 0, c.width, c.height);

  return c;
}

export const DEFAULT_TEMPLATE = {
  size: { w: 2000, h: 2000 },
  // case interior (where the extended art shows) — tuned to the sample render
  interior: { x: 0.235, y: 0.055, w: 0.53, h: 0.86 },
  // card slot centred in the case
  card: { cx: 0.5, cy: 0.5, w: 0.4 },
  art: { offX: 0, offY: 0, zoom: 1 },
  bg: "#f1f1ef",
  overlay: null, // data URL of the glass overlay, once provided
};
