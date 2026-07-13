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

export default function BlenderRenderPanel({ user }) {
  const [jobs, setJobs] = useState(null);
  const [ready, setReady] = useState(true);
  const [card, setCard] = useState(null);
  const [cardName, setCardName] = useState("");
  const [art, setArt] = useState(null);
  const [artName, setArtName] = useState("");
  const [resX, setResX] = useState(2000);
  const [resY, setResY] = useState(2000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [viewing, setViewing] = useState(null); // {id, result}
  const timer = useRef(null);

  const fetchJobs = async () => {
    const { data, error } = await supabase
      .from("render_jobs")
      .select("id,status,error,created_at,created_by_name")
      .order("created_at", { ascending: false })
      .limit(25);
    if (error) { setReady(false); return; }
    setReady(true);
    setJobs(data || []);
  };

  useEffect(() => {
    fetchJobs();
    timer.current = setInterval(fetchJobs, 4000);
    return () => clearInterval(timer.current);
  }, []);

  const pick = async (file, setData, setName) => {
    if (!file) return;
    setData(await readFile(file));
    setName(file.name);
  };

  const submit = async () => {
    setErr(null);
    if (!card || !art) return setErr("Add both a card image and a background artwork.");
    setBusy(true);
    try {
      const { error } = await supabase.from("render_jobs").insert({
        id: uid(), status: "queued", card_image: card, art_image: art,
        params: { resX: Number(resX) || 2000, resY: Number(resY) || 2000 },
        created_by: user.id, created_by_name: user.name,
      });
      if (error) throw new Error(error.message);
      setCard(null); setArt(null); setCardName(""); setArtName("");
      await fetchJobs();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const view = async (id) => {
    const { data } = await supabase.from("render_jobs").select("result_image").eq("id", id).maybeSingle();
    if (data && data.result_image) setViewing({ id, result: data.result_image });
  };
  const download = (result) => { const a = document.createElement("a"); a.href = result; a.download = "kantoforge-render.png"; a.click(); };
  const remove = async (id) => { await supabase.from("render_jobs").delete().eq("id", id); fetchJobs(); };

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

  return (
    <>
      <div className="notice mb small">
        🖥️ Renders run on your PC via the <b>KantoForge render agent</b> (see <code>blender/</code> in the repo). Queue a job
        here, make sure the agent is running, and the finished image comes back below. {active > 0 ? <b>{active} in progress.</b> : null}
      </div>
      <div className="grid two">
        <div className="card" style={{ margin: 0 }}>
          <h3>Queue a render</h3>
          <label className="field mt">
            <span className="lab">Card image</span>
            <input type="file" accept="image/*" onChange={(e) => pick(e.target.files[0], setCard, setCardName)} />
            {cardName && <span className="hint">{cardName}</span>}
          </label>
          <label className="field">
            <span className="lab">Background artwork</span>
            <input type="file" accept="image/*" onChange={(e) => pick(e.target.files[0], setArt, setArtName)} />
            {artName && <span className="hint">{artName}</span>}
          </label>
          <div className="form-row">
            <label className="field"><span className="lab">Width</span><input type="number" value={resX} onChange={(e) => setResX(e.target.value)} /></label>
            <label className="field"><span className="lab">Height</span><input type="number" value={resY} onChange={(e) => setResY(e.target.value)} /></label>
          </div>
          {err && <div className="notice bad mb">⚠️ {err}</div>}
          <button className="btn primary" onClick={submit} disabled={busy}>{busy ? "Queuing…" : "🎬 Queue render"}</button>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h3>Render jobs</h3>
          <div className="table-wrap mt">
            <table className="data">
              <thead><tr><th>When</th><th>By</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {(jobs || []).map((j) => {
                  const st = STATUS[j.status] || STATUS.queued;
                  return (
                    <tr key={j.id}>
                      <td className="muted small">{shortDate(j.created_at)}</td>
                      <td className="small">{j.created_by_name || "—"}</td>
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
          <div onClick={(e) => e.stopPropagation()} style={{ textAlign: "center" }}>
            <img src={viewing.result} alt="render" />
            <div className="row mt" style={{ justifyContent: "center" }}>
              <button className="btn primary" onClick={() => download(viewing.result)}>⬇ Download PNG</button>
              <button className="btn" onClick={() => setViewing(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
