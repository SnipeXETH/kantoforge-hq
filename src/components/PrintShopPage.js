import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { uid } from "../lib/format";
import { loadImage, renderMockup, DEFAULT_CORNERS } from "../lib/mockup";

const MIGRATION = `create table if not exists public.print_mockups (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.print_mockups enable row level security;
create policy "team full access" on public.print_mockups
  for all to authenticated using (true) with check (true);`;

const CORNER_LABELS = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];
const stripExt = (s) => (s || "").replace(/\.[^.]+$/, "");
const slug = (s) => (s || "mockup").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase().slice(0, 40);

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

// Downscale a photo and store it as JPEG to keep the table row small.
async function resizeToJpeg(file, maxDim = 1800, quality = 0.9) {
  const img = await loadImage(await readFile(file));
  let w = img.naturalWidth, h = img.naturalHeight;
  const longest = Math.max(w, h);
  if (longest > maxDim) { const s = maxDim / longest; w = Math.round(w * s); h = Math.round(h * s); }
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Precisely place the four corners of the artwork region: drag, zoom, a
// magnifier loupe, arrow-key nudge, and exact numeric entry.
function CornerEditor({ image, corners, onChange }) {
  const wrapRef = useRef(null);
  const loupeRef = useRef(null);
  const [imgEl, setImgEl] = useState(null);
  const [active, setActive] = useState(0);
  const [drag, setDrag] = useState(false);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let ok = true;
    loadImage(image).then((im) => { if (ok) setImgEl(im); }).catch(() => {});
    return () => { ok = false; };
  }, [image]);

  // paint the magnifier around the active corner
  useEffect(() => {
    const cv = loupeRef.current;
    if (!cv || !imgEl) return;
    const box = cv.width;
    const natW = imgEl.naturalWidth, natH = imgEl.naturalHeight;
    const span = Math.max(24, natW * 0.05); // natural px shown across the loupe
    const cx = corners[active].x * natW, cy = corners[active].y * natH;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, box, box);
    g.drawImage(imgEl, cx - span / 2, cy - span / 2, span, span, 0, 0, box, box);
    g.strokeStyle = "rgba(232,50,63,0.95)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(box / 2, 0); g.lineTo(box / 2, box);
    g.moveTo(0, box / 2); g.lineTo(box, box / 2);
    g.stroke();
  }, [corners, active, imgEl]);

  const setCorner = (i, x, y) => onChange(corners.map((c, idx) => (idx === i ? { x: clamp01(x), y: clamp01(y) } : c)));

  const move = (e) => {
    if (!drag) return;
    const r = wrapRef.current.getBoundingClientRect();
    setCorner(active, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
  };

  const onKey = (e) => {
    const step = e.shiftKey ? 0.01 : 0.001;
    let dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    else return;
    e.preventDefault();
    setCorner(active, corners[active].x + dx, corners[active].y + dy);
  };

  return (
    <div>
      <div className="row mb" style={{ gap: 6, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted small">Corner:</span>
        {CORNER_LABELS.map((l, i) => (
          <button key={i} className={"btn small" + (active === i ? " primary" : "")} onClick={() => setActive(i)}>{l}</button>
        ))}
      </div>
      <div className="row mb" style={{ gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span className="muted small">Zoom</span>
        <input type="range" min={1} max={5} step={0.1} value={zoom} onChange={(e) => setZoom(parseFloat(e.target.value))} style={{ width: 130 }} />
        <span className="muted small">· click a dot, then arrow keys nudge (Shift = bigger)</span>
      </div>
      <div style={{ maxHeight: 480, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
        <div
          ref={wrapRef}
          tabIndex={0}
          onKeyDown={onKey}
          style={{ position: "relative", width: `${zoom * 100}%`, touchAction: "none", userSelect: "none", outline: "none" }}
          onPointerMove={move}
          onPointerUp={() => setDrag(false)}
          onPointerLeave={() => setDrag(false)}
        >
          <img src={image} alt="mockup" style={{ width: "100%", display: "block" }} draggable={false} />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
            <polygon points={corners.map((c) => `${c.x * 100},${c.y * 100}`).join(" ")} fill="rgba(232,50,63,0.12)" stroke="rgba(232,50,63,0.9)" strokeWidth="0.3" vectorEffect="non-scaling-stroke" />
          </svg>
          {corners.map((c, i) => (
            <div
              key={i}
              onPointerDown={() => { setActive(i); setDrag(true); wrapRef.current.focus(); }}
              title={CORNER_LABELS[i]}
              style={{ position: "absolute", left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: 16, height: 16, marginLeft: -8, marginTop: -8, borderRadius: "50%", background: active === i ? "#fff" : "#e8323f", border: `3px solid ${active === i ? "#e8323f" : "#fff"}`, cursor: "grab", boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}
            />
          ))}
        </div>
      </div>
      <div className="row mt" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <canvas ref={loupeRef} width={150} height={150} style={{ width: 150, height: 150, borderRadius: 8, border: "1px solid var(--border)", background: "var(--panel-2)" }} />
        <div>
          <div className="muted small mb">{CORNER_LABELS[active]} — exact position (%)</div>
          <div className="row" style={{ gap: 8 }}>
            <label className="field" style={{ width: 96, margin: 0 }}>
              <span className="lab">X</span>
              <input type="number" step="0.1" value={(corners[active].x * 100).toFixed(1)} onChange={(e) => setCorner(active, (parseFloat(e.target.value) || 0) / 100, corners[active].y)} />
            </label>
            <label className="field" style={{ width: 96, margin: 0 }}>
              <span className="lab">Y</span>
              <input type="number" step="0.1" value={(corners[active].y * 100).toFixed(1)} onChange={(e) => setCorner(active, corners[active].x, (parseFloat(e.target.value) || 0) / 100)} />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PrintShopPage({ user }) {
  const isAdmin = user.role === "admin";
  const [ready, setReady] = useState(true);
  const [mockups, setMockups] = useState(null);
  const [tab, setTab] = useState("generate");

  // generate state
  const [arts, setArts] = useState([]); // {name, src}
  const [selected, setSelected] = useState(() => new Set());
  const [results, setResults] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  // mockup editor state (admin)
  const [editing, setEditing] = useState(null); // {id, name, image, corners, mode}
  const [saving, setSaving] = useState(false);

  const fetchMockups = async () => {
    const { data, error } = await supabase.from("print_mockups").select("id,data").order("updated_at", { ascending: true });
    if (error) { setReady(false); return; }
    setReady(true);
    const list = (data || []).map((r) => ({ id: r.id, ...(r.data || {}) }));
    setMockups(list);
    setSelected((prev) => (prev.size ? prev : new Set(list.map((m) => m.id))));
  };

  useEffect(() => { fetchMockups(); }, []);

  const addArts = async (files) => {
    const next = [];
    for (const f of Array.from(files || [])) {
      if (f.type.startsWith("image/")) next.push({ name: f.name, src: await readFile(f) });
    }
    setArts((a) => [...a, ...next]);
  };

  const toggle = (id) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const generate = async () => {
    setErr(null);
    if (!arts.length) return setErr("Drop at least one artwork image first.");
    const chosen = (mockups || []).filter((m) => selected.has(m.id));
    if (!chosen.length) return setErr("Pick at least one mockup.");
    setBusy(true);
    setResults([]);
    try {
      const loadedMocks = await Promise.all(chosen.map(async (m) => ({ m, img: await loadImage(m.image) })));
      const out = [];
      for (const af of arts) {
        const art = await loadImage(af.src);
        for (const { m, img } of loadedMocks) {
          const cvs = renderMockup(img, art, m.corners || DEFAULT_CORNERS, null, m.mode || "over", m.shade != null ? m.shade : 0.5);
          out.push({ key: af.name + "|" + m.id, mockupName: m.name || "Mockup", artName: af.name, url: cvs.toDataURL("image/jpeg", 0.92) });
        }
      }
      setResults(out);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const download = (r) => { const a = document.createElement("a"); a.href = r.url; a.download = `${stripExt(r.artName)}-${slug(r.mockupName)}.jpg`; a.click(); };
  const downloadAll = () => results.forEach((r, i) => setTimeout(() => download(r), i * 350));

  // --- admin: mockup management ---
  const startAdd = () => setEditing({ id: uid(), name: "", image: null, corners: DEFAULT_CORNERS, mode: "over", shade: 0.5 });
  const startEdit = (m) => setEditing({ id: m.id, name: m.name || "", image: m.image, corners: m.corners || DEFAULT_CORNERS, mode: m.mode || "over", shade: m.shade != null ? m.shade : 0.5 });
  const onMockupFile = async (file) => {
    if (!file) return;
    const image = await resizeToJpeg(file);
    setEditing((e) => ({ ...e, image }));
  };
  const saveMockup = async () => {
    if (!editing.image) return setErr("Upload the mockup photo first.");
    setSaving(true);
    try {
      await supabase.from("print_mockups").upsert({
        id: editing.id,
        data: { name: editing.name.trim() || "Untitled mockup", image: editing.image, corners: editing.corners, mode: editing.mode, shade: editing.shade },
        updated_at: new Date().toISOString(),
      });
      setEditing(null);
      await fetchMockups();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSaving(false);
    }
  };
  const deleteMockup = async (id) => { await supabase.from("print_mockups").delete().eq("id", id); fetchMockups(); };

  if (!ready) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Print shop</h1></div></div>
        <div className="card">
          <h2>One-time database step needed</h2>
          <p className="muted">Run this in Supabase → SQL Editor, then refresh. (Also at <code>supabase/migrations/2026-07-print-mockups.sql</code>.)</p>
          <pre style={{ background: "var(--panel-2)", padding: 14, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{MIGRATION}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Print shop</h1>
          <div className="sub">Drop your artwork and generate every canvas mockup at once.</div>
        </div>
        <div className="pills">
          <button className={tab === "generate" ? "active" : ""} onClick={() => setTab("generate")}>Generate</button>
          {isAdmin && <button className={tab === "mockups" ? "active" : ""} onClick={() => setTab("mockups")}>Mockups{mockups ? ` (${mockups.length})` : ""}</button>}
        </div>
      </div>

      {err && <div className="notice bad mb">⚠️ {err}</div>}

      {tab === "generate" && (
        <>
          {mockups && !mockups.length && (
            <div className="notice mb">ℹ️ No mockups set up yet. {isAdmin ? "Go to the Mockups tab to add your first one." : "Ask an admin to add mockup templates."}</div>
          )}
          <div className="grid" style={{ gridTemplateColumns: "320px minmax(0,1fr)", gap: 20 }}>
            <div>
              <div className="card" style={{ margin: 0 }}>
                <h3>1 · Your artwork</h3>
                <label className="field mt">
                  <span className="lab">Drop or choose images</span>
                  <input type="file" accept="image/*" multiple onChange={(e) => addArts(e.target.files)} />
                </label>
                {arts.length > 0 && (
                  <>
                    <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
                      {arts.map((a, i) => (
                        <div key={i} title={a.name} style={{ position: "relative" }}>
                          <img src={a.src} alt={a.name} style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 6 }} />
                          <button className="btn small danger" style={{ position: "absolute", top: -6, right: -6, padding: "0 6px" }} onClick={() => setArts((x) => x.filter((_, j) => j !== i))}>✕</button>
                        </div>
                      ))}
                    </div>
                    <button className="btn small mt" onClick={() => setArts([])}>Clear all</button>
                  </>
                )}
              </div>

              {mockups && mockups.length > 0 && (
                <div className="card mt" style={{ margin: 0 }}>
                  <h3>2 · Mockups</h3>
                  <div className="mt">
                    {mockups.map((m) => (
                      <label key={m.id} className="row" style={{ gap: 8, padding: "4px 0", cursor: "pointer" }}>
                        <input type="checkbox" checked={selected.has(m.id)} onChange={() => toggle(m.id)} />
                        <img src={m.image} alt={m.name} style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 5 }} />
                        <span>{m.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              <div className="card mt" style={{ margin: 0 }}>
                <button className="btn primary" onClick={generate} disabled={busy || !arts.length || !(mockups && mockups.length)}>
                  {busy ? "Generating…" : `✨ Generate ${arts.length * selected.size || ""} mockup${arts.length * selected.size === 1 ? "" : "s"}`}
                </button>
                {results.length > 0 && <button className="btn mt" onClick={downloadAll}>⬇ Download all ({results.length})</button>}
              </div>
            </div>

            <div className="card" style={{ margin: 0 }}>
              <h3>Results</h3>
              {!results.length && <div className="muted mt">Your generated mockups will appear here.</div>}
              <div className="grid mt" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12 }}>
                {results.map((r) => (
                  <div key={r.key} className="card" style={{ margin: 0, padding: 8 }}>
                    <img src={r.url} alt={r.mockupName} style={{ width: "100%", borderRadius: 6, display: "block" }} />
                    <div className="row mt" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <span className="muted small" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.mockupName}</span>
                      <button className="btn small" onClick={() => download(r)}>⬇</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "mockups" && isAdmin && (
        <>
          {!editing && (
            <>
              <button className="btn primary mb" onClick={startAdd}>+ Add mockup</button>
              <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 14 }}>
                {(mockups || []).map((m) => (
                  <div key={m.id} className="card" style={{ margin: 0 }}>
                    <img src={m.image} alt={m.name} style={{ width: "100%", borderRadius: 6, display: "block" }} />
                    <div className="row mt" style={{ justifyContent: "space-between", alignItems: "center" }}>
                      <b>{m.name}</b>
                      <span className="row" style={{ gap: 6 }}>
                        <button className="btn small" onClick={() => startEdit(m)}>Edit</button>
                        <button className="btn small danger" onClick={() => deleteMockup(m.id)}>Delete</button>
                      </span>
                    </div>
                  </div>
                ))}
                {mockups && !mockups.length && <div className="muted">No mockups yet — add your first one.</div>}
              </div>
            </>
          )}

          {editing && (
            <div className="card" style={{ margin: 0 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 style={{ margin: 0 }}>{editing.image ? "Position the artwork area" : "Add a mockup"}</h2>
                <button className="btn small" onClick={() => setEditing(null)}>Cancel</button>
              </div>
              {!editing.image ? (
                <label className="field mt">
                  <span className="lab">Mockup photo (e.g. a blank canvas on a wall)</span>
                  <input type="file" accept="image/*" onChange={(e) => onMockupFile(e.target.files[0])} />
                </label>
              ) : (
                <div className="grid mt" style={{ gridTemplateColumns: "minmax(0,1fr) 260px", gap: 18 }}>
                  <div>
                    <div className="card-sub mb">Drag the four dots to the corners of the canvas where the artwork should sit.</div>
                    <CornerEditor image={editing.image} corners={editing.corners} onChange={(corners) => setEditing((e) => ({ ...e, corners }))} />
                  </div>
                  <div>
                    <label className="field">
                      <span className="lab">Name</span>
                      <input type="text" value={editing.name} onChange={(e) => setEditing((x) => ({ ...x, name: e.target.value }))} placeholder="e.g. Living room wall" />
                    </label>
                    <label className="field">
                      <span className="lab">Artwork sits…</span>
                      <select value={editing.mode} onChange={(e) => setEditing((x) => ({ ...x, mode: e.target.value }))}>
                        <option value="over">On top of the photo (blank-canvas photo)</option>
                        <option value="under">Behind the photo (transparent PNG overlay)</option>
                      </select>
                      <span className="hint">Use "behind" only if your mockup is a PNG with the canvas area cut out.</span>
                    </label>
                    {editing.mode !== "under" && (
                      <label className="field">
                        <span className="lab">Blend shading — {Math.round((editing.shade != null ? editing.shade : 0.5) * 100)}%</span>
                        <input type="range" min={0} max={1} step={0.05} value={editing.shade != null ? editing.shade : 0.5} onChange={(e) => setEditing((x) => ({ ...x, shade: parseFloat(e.target.value) }))} />
                        <span className="hint">Lets the canvas texture &amp; shadows show through the art for a realistic finish. Lower it if the art looks too dark.</span>
                      </label>
                    )}
                    <label className="field">
                      <span className="lab">Replace photo</span>
                      <input type="file" accept="image/*" onChange={(e) => onMockupFile(e.target.files[0])} />
                    </label>
                    <button className="btn primary mt" onClick={saveMockup} disabled={saving}>{saving ? "Saving…" : "Save mockup"}</button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
