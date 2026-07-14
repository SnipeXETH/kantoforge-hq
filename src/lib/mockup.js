// Canvas mockup compositor. Warps a piece of artwork into the four-corner
// region of a mockup photo (supports perspective/angled canvases), so one
// dropped image becomes many finished product mockups.

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error("Couldn't load that image."));
    i.src = src;
  });
}

// Default corners (as fractions of the mockup) — a centred rectangle to start.
export const DEFAULT_CORNERS = [
  { x: 0.25, y: 0.2 }, // top-left
  { x: 0.75, y: 0.2 }, // top-right
  { x: 0.75, y: 0.8 }, // bottom-right
  { x: 0.25, y: 0.8 }, // bottom-left
];

// Projective transform mapping the unit square -> destination quad
// (Heckbert's square-to-quad). Returns fn(u,v) -> [x, y].
function squareToQuad(q) {
  const [p0, p1, p2, p3] = q; // TL, TR, BR, BL  == (0,0),(1,0),(1,1),(0,1)
  const x0 = p0.x, y0 = p0.y, x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y, x3 = p3.x, y3 = p3.y;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x3 - x0; c = x0;
    d = y1 - y0; e = y3 - y0; f = y0;
    g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1;
    b = x3 - x0 + h * x3;
    c = x0;
    d = y1 - y0 + g * y1;
    e = y3 - y0 + h * y3;
    f = y0;
  }
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

// Draw a source triangle of `img` (pixel coords u,v) into a destination
// triangle (canvas coords x,y) via an affine transform + clip.
function drawTriangle(ctx, img, x0, y0, x1, y1, x2, y2, u0, v0, u1, v1, u2, v2) {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.clip();
  u1 -= u0; v1 -= v0; u2 -= u0; v2 -= v0;
  x1 -= x0; y1 -= y0; x2 -= x0; y2 -= y0;
  const det = u1 * v2 - u2 * v1;
  if (Math.abs(det) < 1e-9) { ctx.restore(); return; }
  const a = (v2 * x1 - v1 * x2) / det;
  const b = (v2 * y1 - v1 * y2) / det;
  const c = (u1 * x2 - u2 * x1) / det;
  const d = (u1 * y2 - u2 * y1) / det;
  const e = x0 - a * u0 - c * v0;
  const f = y0 - b * u0 - d * v0;
  ctx.setTransform(a, b, c, d, e, f);
  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

// Warp `art` into the quad (fractional corners) over a canvas of size W x H.
export function warpArtwork(ctx, art, corners, W, H, grid = 32) {
  const abs = corners.map((p) => ({ x: p.x * W, y: p.y * H }));
  const tf = squareToQuad(abs);
  const aw = art.naturalWidth || art.width;
  const ah = art.naturalHeight || art.height;
  const ov = 0.5 / grid; // tiny overlap to avoid seams between cells
  for (let i = 0; i < grid; i++) {
    for (let j = 0; j < grid; j++) {
      const u0 = i / grid, u1 = (i + 1) / grid;
      const v0 = j / grid, v1 = (j + 1) / grid;
      // expand slightly
      const eu0 = Math.max(0, u0 - ov), eu1 = Math.min(1, u1 + ov);
      const ev0 = Math.max(0, v0 - ov), ev1 = Math.min(1, v1 + ov);
      const d00 = tf(eu0, ev0), d10 = tf(eu1, ev0), d11 = tf(eu1, ev1), d01 = tf(eu0, ev1);
      const s00u = eu0 * aw, s00v = ev0 * ah, s10u = eu1 * aw, s11v = ev1 * ah, s01u = eu0 * aw;
      // triangle 1: 00,10,11
      drawTriangle(ctx, art, d00[0], d00[1], d10[0], d10[1], d11[0], d11[1], s00u, s00v, s10u, s00v, s10u, s11v);
      // triangle 2: 00,11,01
      drawTriangle(ctx, art, d00[0], d00[1], d11[0], d11[1], d01[0], d01[1], s00u, s00v, s10u, s11v, s01u, s11v);
    }
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// Render one finished mockup at the mockup's native resolution.
//   mode "over"  (default) — art sits on top of the mockup photo. Use for a
//                photo of a blank canvas where the art fills that area.
//   mode "under" — art sits beneath the mockup, which is a transparent PNG
//                with a window cut out (reflections/frame stay on top).
export function renderMockup(mockup, art, corners, canvas, mode = "over", shade = 0.5) {
  const cvs = canvas || document.createElement("canvas");
  const W = mockup.naturalWidth || mockup.width;
  const H = mockup.naturalHeight || mockup.height;
  cvs.width = W;
  cvs.height = H;
  const ctx = cvs.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  if (mode === "under") {
    warpArtwork(ctx, art, corners, W, H);
    ctx.drawImage(mockup, 0, 0, W, H);
    return cvs;
  }
  // "over": draw the scene, then the art clipped to the canvas region, then
  // multiply the mockup's shading back over the art so the canvas texture and
  // shadows show through instead of the art looking flatly pasted on.
  ctx.drawImage(mockup, 0, 0, W, H);
  const abs = corners.map((p) => ({ x: p.x * W, y: p.y * H }));
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(abs[0].x, abs[0].y);
  for (let i = 1; i < 4; i++) ctx.lineTo(abs[i].x, abs[i].y);
  ctx.closePath();
  ctx.clip();
  warpArtwork(ctx, art, corners, W, H);
  if (shade > 0) {
    ctx.globalCompositeOperation = "multiply";
    ctx.globalAlpha = shade;
    ctx.drawImage(mockup, 0, 0, W, H);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  }
  ctx.restore();
  return cvs;
}
