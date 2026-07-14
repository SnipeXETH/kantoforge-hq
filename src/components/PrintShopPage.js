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

// Drag the four corners of the artwork region over the mockup photo.
function CornerEditor({ image, corners, onChange }) {
  const wrapRef = useRef(null);
  const [drag, setDrag] = useState(null);
  const move = (e) => {
    if (drag == null) return;
    const r = wrapRef.current.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    onChange(corners.map((c, i) => (i === drag ? { x, y } : c)));
  };
  return (
    <div
      ref={wrapRef}
      style={{ position: "relative", touchAction: "none", userSelect: "none", maxWidth: 520, width: "100%" }}
      onPointerMove={move}
      onPointerUp={() => setDrag(null)}
      onPointerLeave={() => setDrag(null)}
    >
      <img src={image} alt="mockup" style={{ width: "100%", display: "block", borderRadius: 8 }} draggable={false} />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
        <polygon points={corners.map((c) => `${c.x * 100},${c.y * 100}`).join(" ")} fill="rgba(232,50,63,0.14)" stroke="rgba(232,50,63,0.9)" strokeWidth="0.4" />
      </svg>
      {corners.map((c, i) => (
        <div
          key={i}
          onPointerDown={() => setDrag(i)}
          title={CORNER_LABELS[i]}
          style={{ position: "absolute", left: `${c.x * 100}%`, top: `${c.y * 100}%`, width: 20, height: 20, marginLeft: -10, marginTop: -10, borderRadius: "50%", background: "#e8323f", border: "2px solid #fff", cursor: "grab", boxShadow: "0 1px 4px rgba(0,0,0,0.5)" }}
        />
      ))}
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
          const cvs = renderMockup(img, art, m.corners || DEFAULT_CORNERS, null, m.mode || "over");
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
  const startAdd = () => setEditing({ id: uid(), name: "", image: null, corners: DEFAULT_CORNERS, mode: "over" });
  const startEdit = (m) => setEditing({ id: m.id, name: m.name || "", image: m.image, corners: m.corners || DEFAULT_CORNERS, mode: m.mode || "over" });
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
        data: { name: editing.name.trim() || "Untitled mockup", image: editing.image, corners: editing.corners, mode: editing.mode },
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
