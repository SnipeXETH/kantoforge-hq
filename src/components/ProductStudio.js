import React, { useEffect, useMemo, useRef, useState } from "react";
import { composite, DEFAULT_TEMPLATE } from "../lib/composite";
import BlenderRenderPanel from "./BlenderRenderPanel";

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

function imageSize(src) {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve({ w: i.naturalWidth, h: i.naturalHeight });
    i.onerror = () => resolve(null);
    i.src = src;
  });
}

const PREVIEW_MAX = 560;

export default function ProductStudio({ db, update, user }) {
  const isAdmin = user.role === "admin";
  const saved = db.settings.productTemplate || DEFAULT_TEMPLATE;

  const [overlay, setOverlay] = useState(saved.overlay || null);
  const [size, setSize] = useState(saved.size || DEFAULT_TEMPLATE.size);
  const [interior, setInterior] = useState(saved.interior || DEFAULT_TEMPLATE.interior);
  const [card, setCard] = useState(saved.card || DEFAULT_TEMPLATE.card);
  const [art, setArt] = useState(saved.art || DEFAULT_TEMPLATE.art);
  const [bg, setBg] = useState(saved.bg || DEFAULT_TEMPLATE.bg);

  const [artSrc, setArtSrc] = useState(null);
  const [cardSrc, setCardSrc] = useState(null);
  const [mode, setMode] = useState("card"); // which layer the drag moves
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const [tool, setTool] = useState("composite"); // "composite" | "render"
  const previewRef = useRef(null);
  const dragRef = useRef(null);

  const spec = useMemo(
    () => ({ size, bg, artSrc, cardSrc, overlaySrc: overlay, interior, art, card }),
    [size, bg, artSrc, cardSrc, overlay, interior, art, card]
  );

  // preview scale
  const scale = Math.min(PREVIEW_MAX / size.w, PREVIEW_MAX / size.h);
  const pw = Math.round(size.w * scale);
  const ph = Math.round(size.h * scale);

  // re-render preview whenever anything changes
  useEffect(() => {
    let alive = true;
    (async () => {
      const canvas = previewRef.current;
      if (!canvas) return;
      const previewSpec = { ...spec, size: { w: pw, h: ph } };
      await composite(previewSpec, canvas).catch(() => {});
      if (!alive) return;
    })();
    return () => { alive = false; };
  }, [spec, pw, ph]);

  const onUpload = async (setter, file, isOverlay) => {
    if (!file) return;
    const url = await readFile(file);
    setter(url);
    if (isOverlay) {
      const dim = await imageSize(url);
      if (dim) setSize(dim); // match export size to the overlay's native size
    }
  };

  // dragging the active layer
  const onPointerDown = (e) => {
    const rect = previewRef.current.getBoundingClientRect();
    dragRef.current = { x: e.clientX, y: e.clientY, rect, start: mode === "card" ? { ...card } : { ...art } };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = (e.clientX - d.x) / d.rect.width;
    const dy = (e.clientY - d.y) / d.rect.height;
    if (mode === "card") setCard({ ...d.start, cx: clamp(d.start.cx + dx), cy: clamp(d.start.cy + dy) });
    else setArt({ ...d.start, offX: (d.start.offX || 0) + dx, offY: (d.start.offY || 0) + dy });
  };
  const onPointerUp = (e) => { dragRef.current = null; };

  const saveTemplate = () => {
    update((dd) => ({ ...dd, settings: { ...dd.settings, productTemplate: { size, interior, card, art, bg, overlay } } }));
    setMsg("Template saved — these settings and the overlay will be reused next time.");
    setTimeout(() => setMsg(null), 2500);
  };

  const exportPng = async () => {
    setBusy(true);
    try {
      const canvas = await composite(spec);
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = "kantoforge-product-" + Date.now() + ".png";
      a.click();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Product image studio</h1>
          <div className="sub">Turn artwork + card into product images — a fast 2D composite, or a full Blender render via your PC.</div>
        </div>
        <div className="pills">
          <button className={tool === "composite" ? "active" : ""} onClick={() => setTool("composite")}>2D composite</button>
          <button className={tool === "render" ? "active" : ""} onClick={() => setTool("render")}>3D render (Blender)</button>
        </div>
      </div>

      {tool === "render" && <BlenderRenderPanel user={user} />}
      {tool === "render" ? null : (
      <>
      {msg && <div className="notice good mb">✅ {msg}</div>}
      {!overlay && (
        <div className="notice mb">
          ℹ️ No case overlay loaded yet, so you'll just see the art + card. Upload the transparent “glass overlay” PNG below
          (the fixed case, reflections, watermark &amp; branding) and it'll frame everything — then save it as the template.
        </div>
      )}

      <div className="grid" style={{ gridTemplateColumns: "minmax(0, 1fr) 320px", gap: 20 }}>
        <div className="card" style={{ margin: 0 }}>
          <div className="row mb" style={{ justifyContent: "space-between" }}>
            <div className="pills">
              <button className={mode === "card" ? "active" : ""} onClick={() => setMode("card")}>Move card</button>
              <button className={mode === "art" ? "active" : ""} onClick={() => setMode("art")}>Move background</button>
            </div>
            <span className="muted small">Drag on the preview to position the {mode === "card" ? "card" : "artwork"}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "center", background: "var(--panel-2)", borderRadius: 10, padding: 14 }}>
            <canvas
              ref={previewRef}
              width={pw}
              height={ph}
              style={{ width: pw, height: ph, borderRadius: 6, cursor: "grab", touchAction: "none", maxWidth: "100%" }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
            />
          </div>
        </div>

        <div>
          <div className="card" style={{ margin: 0 }}>
            <h3>Images</h3>
            <label className="field mt">
              <span className="lab">Background artwork</span>
              <input type="file" accept="image/*" onChange={(e) => onUpload(setArtSrc, e.target.files[0])} />
            </label>
            <label className="field">
              <span className="lab">Card image</span>
              <input type="file" accept="image/*" onChange={(e) => onUpload(setCardSrc, e.target.files[0])} />
            </label>
            {isAdmin && (
              <label className="field">
                <span className="lab">Case glass overlay (transparent PNG)</span>
                <input type="file" accept="image/png" onChange={(e) => onUpload(setOverlay, e.target.files[0], true)} />
                <span className="hint">The fixed case + reflections + watermark. Loaded once, saved with the template.</span>
              </label>
            )}
          </div>

          <div className="card mt" style={{ margin: 0 }}>
            <h3>Card</h3>
            <Slider label="Size" min={0.15} max={0.75} step={0.002} value={card.w} onChange={(v) => setCard({ ...card, w: v })} />
            <Slider label="Horizontal" min={0} max={1} step={0.002} value={card.cx} onChange={(v) => setCard({ ...card, cx: v })} />
            <Slider label="Vertical" min={0} max={1} step={0.002} value={card.cy} onChange={(v) => setCard({ ...card, cy: v })} />
            <h3 style={{ marginTop: 12 }}>Background artwork</h3>
            <Slider label="Zoom" min={0.5} max={2.5} step={0.01} value={art.zoom || 1} onChange={(v) => setArt({ ...art, zoom: v })} />
            <Slider label="Horizontal" min={-0.5} max={0.5} step={0.002} value={art.offX || 0} onChange={(v) => setArt({ ...art, offX: v })} />
            <Slider label="Vertical" min={-0.5} max={0.5} step={0.002} value={art.offY || 0} onChange={(v) => setArt({ ...art, offY: v })} />

            <button className="btn small mt" onClick={() => setShowAdvanced(!showAdvanced)}>{showAdvanced ? "Hide" : "Advanced: case interior"}</button>
            {showAdvanced && (
              <div className="mt">
                <div className="card-sub">The rectangle the artwork fills (fractions of the canvas).</div>
                <Slider label="Left" min={0} max={0.5} step={0.002} value={interior.x} onChange={(v) => setInterior({ ...interior, x: v })} />
                <Slider label="Top" min={0} max={0.5} step={0.002} value={interior.y} onChange={(v) => setInterior({ ...interior, y: v })} />
                <Slider label="Width" min={0.2} max={1} step={0.002} value={interior.w} onChange={(v) => setInterior({ ...interior, w: v })} />
                <Slider label="Height" min={0.2} max={1} step={0.002} value={interior.h} onChange={(v) => setInterior({ ...interior, h: v })} />
                <label className="field mt">
                  <span className="lab">Background colour (outside the case)</span>
                  <input type="color" value={bg} onChange={(e) => setBg(e.target.value)} />
                </label>
                <div className="form-row">
                  <label className="field"><span className="lab">Export width</span><input type="number" value={size.w} onChange={(e) => setSize({ ...size, w: parseInt(e.target.value) || 2000 })} /></label>
                  <label className="field"><span className="lab">Export height</span><input type="number" value={size.h} onChange={(e) => setSize({ ...size, h: parseInt(e.target.value) || 2000 })} /></label>
                </div>
              </div>
            )}
          </div>

          <div className="card mt" style={{ margin: 0 }}>
            <div className="row">
              <button className="btn primary" onClick={exportPng} disabled={busy || (!artSrc && !cardSrc)}>{busy ? "Rendering…" : "⬇ Export product image"}</button>
              {isAdmin && <button className="btn" onClick={saveTemplate}>Save as template</button>}
            </div>
            <div className="muted small mt">Exports at {size.w}×{size.h}. Positions are saved with the template so every future image starts aligned.</div>
          </div>
        </div>
      </div>
      </>
      )}
    </div>
  );
}

function clamp(v) { return Math.max(0, Math.min(1, v)); }

function Slider({ label, min, max, step, value, onChange }) {
  return (
    <label className="field" style={{ marginBottom: 8 }}>
      <span className="lab" style={{ display: "flex", justifyContent: "space-between" }}>
        <span>{label}</span><span className="muted">{(value != null ? value : 0).toFixed(3)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(parseFloat(e.target.value))} style={{ width: "100%" }} />
    </label>
  );
}
