import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { uid, shortDate } from "../lib/format";

function readFile(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn't read that file."));
    r.readAsDataURL(file);
  });
}

const STATUS = {
  queued: { label: "Queued", cls: "yellow" },
  rendering: { label: "Rendering…", cls: "blue" },
  done: { label: "Done", cls: "green" },
  failed: { label: "Failed", cls: "red" },
};

const stripExt = (s) => (s || "").replace(/\.[^.]+$/, "");
function jobName(j) {
  const p = j.params || {};
  return stripExt(p.cardName) || stripExt(p.artName) || p.label || "Untitled render";
}

const MIGRATION = `create table if not exists public.render_jobs (
  id text primary key, status text not null default 'queued',
  params jsonb not null default '{}'::jsonb,
  card_image text, art_image text, result_image text, error text,
  created_by text, created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.render_jobs enable row level security;
create policy "team full access" on public.render_jobs
  for all to authenticated using (true) with check (true);`;

// A chip list of picked files with per-item remove.
function FileChips({ items, onRemove }) {
  if (!items.length) return null;
  return (
    <div className="row mt" style={{ flexWrap: "wrap", gap: 6 }}>
      {items.map((f) => (
        <span key={f.key} className="badge" style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: 220 }}>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
          <button className="linklike" style={{ border: "none", background: "none", cursor: "pointer", padding: 0, lineHeight: 1 }} onClick={() => onRemove(f.key)} title="Remove">✕</button>
        </span>
      ))}
    </div>
  );
}

export default function BlenderRenderPanel({ user }) {
  const [jobs, setJobs] = useState(null);
  const [ready, setReady] = useState(true);
  const [cards, setCards] = useState([]); // [{key,name,data}]
  const [arts, setArts] = useState([]);
  const [mode, setMode] = useState("matrix"); // matrix = every card × every background; pairs = card[i] with art[i]
  const [resX, setResX] = useState(2000);
  const [resY, setResY] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [viewing, setViewing] = useState(null); // {id, result}
  const cardRef = useRef(null);
  const artRef = useRef(null);
  const timer = useRef(null);

  const fetchJobs = async () => {
    const { data, error } = await supabase
      .from("render_jobs")
      .select("id,status,error,created_at,created_by_name,params")
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) { setReady(false); return; }
    setReady(true);
    setJobs(data || []);
  };

  useEffect(() => {
    fetchJobs();
    timer.current = setInterval(fetchJobs, 4000);
    return () => clearInterval(timer.current);
  }, []);

  const pickMany = async (fileList, setList, inputRef) => {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setErr(null);
    const read = await Promise.all(files.map(async (f) => ({ key: uid(), name: f.name, data: await readFile(f) })));
    setList((prev) => [...prev, ...read]);
    if (inputRef.current) inputRef.current.value = ""; // let the same file be re-picked later
  };
  const removeFrom = (setList) => (key) => setList((prev) => prev.filter((f) => f.key !== key));

  // Which (card, art) combinations will be queued.
  const buildPairs = () => {
    if (!cards.length || !arts.length) return [];
    if (mode === "pairs") {
      const n = Math.min(cards.length, arts.length);
      return Array.from({ length: n }, (_, i) => [cards[i], arts[i]]);
    }
    const out = [];
    for (const cd of cards) for (const a of arts) out.push([cd, a]);
    return out;
  };
  const pairs = buildPairs();
  const count = pairs.length;

  const submit = async () => {
    setErr(null);
    if (!cards.length || !arts.length) return setErr("Add at least one card image and one background artwork.");
    if (!count) return setErr("Nothing to queue with the current combine setting.");
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const rows = pairs.map(([cd, a]) => ({
        id: uid(), status: "queued", card_image: cd.data, art_image: a.data,
        params: { resX: Number(resX) || 2000, resY: Number(resY) || 2000, cardName: cd.name, artName: a.name },
        created_by: user.id, created_by_name: user.name, created_at: now,
      }));
      const { error } = await supabase.from("render_jobs").insert(rows);
      if (error) throw new Error(error.message);
      setCards([]); setArts([]);
      await fetchJobs();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const view = async (id) => {
    setErr(null);
    setViewing({ id, result: null });
    const { data, error } = await supabase.from("render_jobs").select("result_image").eq("id", id).maybeSingle();
    if (error || !data || !data.result_image) {
      setViewing(null);
      setErr(error ? error.message : "That render has no image saved yet — it may still be rendering or have failed.");
      return;
    }
    setViewing({ id, result: data.result_image });
  };
  const download = (result) => { const a = document.createElement("a"); a.href = result; a.download = "kantoforge-render.png"; a.click(); };
  const remove = async (id) => { await supabase.from("render_jobs").delete().eq("id", id); fetchJobs(); };
  const clearFinished = async () => {
    const ids = (jobs || []).filter((j) => j.status === "done" || j.status === "failed").map((j) => j.id);
    if (!ids.length) return;
    if (!window.confirm(`Remove ${ids.length} finished render${ids.length === 1 ? "" : "s"} from the list?`)) return;
    await supabase.from("render_jobs").delete().in("id", ids);
    fetchJobs();
  };

  if (!ready) {
    return (
      <div className="card">
        <h2>One-time database step needed</h2>
        <p className="muted">Run this in Supabase → SQL Editor, then refresh. (Also at <code>supabase/migrations/2026-07-render-queue.sql</code>.)</p>
        <pre style={{ background: "var(--panel-2)", padding: 14, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{MIGRATION}</pre>
      </div>
    );
  }

  const active = (jobs || []).filter((j) => j.status === "queued" || j.status === "rendering").length;
  const bothMulti = cards.length > 1 && arts.length > 1;

  return (
    <>
      <div className="notice mb small">
        🖥️ Renders run on your PC via the <b>KantoForge render agent</b> (see <code>blender/</code> in the repo). Queue jobs
        here, make sure the agent is running, and finished images come back below. {active > 0 ? <b>{active} in progress.</b> : null}
      </div>
      <div className="grid two">
        <div className="card" style={{ margin: 0 }}>
          <h3>Queue renders</h3>
          <div className="muted small mb">Add one or several of each — every job is one card on one background. Pick multiple to batch a whole set at once.</div>

          <label className="field mt">
            <span className="lab">Card image{cards.length ? ` · ${cards.length}` : ""}</span>
            <input ref={cardRef} type="file" accept="image/*" multiple onChange={(e) => pickMany(e.target.files, setCards, cardRef)} />
          </label>
          <FileChips items={cards} onRemove={removeFrom(setCards)} />

          <label className="field mt">
            <span className="lab">Background artwork{arts.length ? ` · ${arts.length}` : ""}</span>
            <input ref={artRef} type="file" accept="image/*" multiple onChange={(e) => pickMany(e.target.files, setArts, artRef)} />
          </label>
          <FileChips items={arts} onRemove={removeFrom(setArts)} />

          {bothMulti && (
            <label className="field mt">
              <span className="lab">Combine</span>
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="matrix">Every card on every background ({cards.length} × {arts.length})</option>
                <option value="pairs">Pair in order (card 1 + bg 1, card 2 + bg 2…)</option>
              </select>
            </label>
          )}

          <div className="form-row mt">
            <label className="field"><span className="lab">Width</span><input type="number" value={resX} onChange={(e) => setResX(e.target.value)} /></label>
            <label className="field"><span className="lab">Height</span><input type="number" value={resY} onChange={(e) => setResY(e.target.value)} /></label>
          </div>

          {count > 0 && <div className="muted small mt">This will queue <b>{count}</b> render{count === 1 ? "" : "s"}{resX && resY ? ` at ${Number(resX) || 2000}×${Number(resY) || 2000}` : ""}.</div>}
          {count > 24 && <div className="notice mt small">⚠️ That's a big batch — it'll tie up your render PC for a while. Trim the sets or switch to “Pair in order” if you didn't mean every combination.</div>}
          {err && <div className="notice bad mb mt">⚠️ {err}</div>}
          <button className="btn primary mt" onClick={submit} disabled={busy || !count}>{busy ? "Queuing…" : `🎬 Queue ${count || ""} render${count === 1 ? "" : "s"}`.replace("  ", " ")}</button>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Render jobs</h3>
            {(jobs || []).some((j) => j.status === "done" || j.status === "failed") && (
              <button className="btn small" onClick={clearFinished}>Clear finished</button>
            )}
          </div>
          <div className="table-wrap mt">
            <table className="data">
              <thead><tr><th>Render</th><th>When</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(jobs || []).map((j) => {
                  const st = STATUS[j.status] || STATUS.queued;
                  const name = jobName(j);
                  return (
                    <tr key={j.id}>
                      <td>
                        <b style={{ fontWeight: 600 }}>{name}</b>
                        {j.created_by_name ? <div className="muted small">by {j.created_by_name}</div> : null}
                      </td>
                      <td className="muted small">{shortDate(j.created_at)}</td>
                      <td><span className={"badge " + st.cls}>{st.label}</span>{j.status === "failed" && j.error ? <div className="muted small" style={{ maxWidth: 200 }}>{j.error.slice(0, 120)}</div> : null}</td>
                      <td className="num">
                        <span className="row" style={{ justifyContent: "flex-end" }}>
                          {j.status === "done" && <button className="btn small" onClick={() => view(j.id)}>View</button>}
                          <button className="btn small danger" onClick={() => remove(j.id)}>✕</button>
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {jobs && !jobs.length && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 22 }}>No renders yet.</td></tr>}
                {jobs === null && <tr><td colSpan={4} className="muted" style={{ textAlign: "center", padding: 22 }}>Loading…</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {viewing && (
        <div className="lightbox" onClick={() => setViewing(null)}>
          <div onClick={(e) => e.stopPropagation()} style={{ textAlign: "center", maxWidth: "92vw" }}>
            {viewing.result
              ? <img src={viewing.result} alt="render" style={{ maxWidth: "90vw", maxHeight: "78vh", objectFit: "contain", borderRadius: 6 }} />
              : <div className="muted" style={{ padding: 40 }}>Loading render…</div>}
            <div className="row mt" style={{ justifyContent: "center" }}>
              {viewing.result && <button className="btn primary" onClick={() => download(viewing.result)}>⬇ Download PNG</button>}
              <button className="btn" onClick={() => setViewing(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
