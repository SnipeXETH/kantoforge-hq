import React, { useMemo, useState } from "react";
import { uid, shortDate } from "../lib/format";
import { fileToResizedDataUrl } from "../lib/image";
import { RoleBadges } from "./badges";

const STATUS = {
  requested: { label: "Requested", cls: "yellow" },
  approved: { label: "Approved", cls: "blue" },
  in_progress: { label: "In progress", cls: "violet" },
  completed: { label: "Completed", cls: "green" },
  denied: { label: "Denied", cls: "red" },
};

const FILTERS = [
  ["open", "Open"],
  ["requested", "Requested"],
  ["approved", "Approved"],
  ["in_progress", "In progress"],
  ["completed", "Completed"],
  ["denied", "Denied"],
  ["all", "All"],
];

function initials(name) {
  return (name || "?").split(" ").map((p) => p[0]).join("").slice(0, 2).toUpperCase();
}

function Who({ name, badges }) {
  return (
    <span className="row" style={{ gap: 6, display: "inline-flex" }}>
      <span className="avatar" style={{ width: 20, height: 20, fontSize: 9 }}>{initials(name)}</span>
      <b style={{ fontWeight: 600 }}>{name || "—"}</b>
      <RoleBadges badges={badges} size={10} />
    </span>
  );
}

function CommissionCard({ c, db, user, update }) {
  const isAdmin = user.role === "admin";
  const isArtist = isAdmin || (user.badges || []).includes("Artist") || c.assigneeId === user.id;
  const [action, setAction] = useState(null); // "approve" | "deny" | "complete" | null
  const [file, setFile] = useState(null);
  const [assigneeId, setAssigneeId] = useState(() => {
    const artist = db.users.find((u) => (u.badges || []).includes("Artist"));
    return artist ? artist.id : "";
  });
  const [denyReason, setDenyReason] = useState("");
  const [finalLink, setFinalLink] = useState(c.finalLink || "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [lightbox, setLightbox] = useState(false);

  const badgesOf = (id) => {
    const u = db.users.find((x) => x.id === id);
    return u ? u.badges : [];
  };

  const mutate = (fn, historyAction) =>
    update((d) => ({
      ...d,
      commissions: d.commissions.map((x) => {
        if (x.id !== c.id) return x;
        const next = fn({ ...x });
        next.updatedAt = new Date().toISOString();
        next.updatedByName = user.name;
        if (historyAction) next.history = [...(x.history || []), { at: next.updatedAt, byName: user.name, action: historyAction }];
        return next;
      }),
    }));

  const approve = async () => {
    setErr(null);
    if (!file) return setErr("Upload a PNG of the card first.");
    setBusy(true);
    try {
      const image = await fileToResizedDataUrl(file);
      const assignee = db.users.find((u) => u.id === assigneeId);
      mutate(
        (x) => ({
          ...x,
          status: "approved",
          cardImage: image,
          assigneeId: assigneeId || null,
          assigneeName: assignee ? assignee.name : "",
        }),
        "Approved" + (assignee ? ` · assigned to ${assignee.name}` : "")
      );
      setAction(null);
      setFile(null);
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
    }
  };

  const deny = () => {
    mutate((x) => ({ ...x, status: "denied", denyReason: denyReason.trim() }), "Denied" + (denyReason.trim() ? `: ${denyReason.trim()}` : ""));
    setAction(null);
  };

  const start = () => mutate((x) => ({ ...x, status: "in_progress" }), "Started work");

  const complete = () => {
    if (!finalLink.trim()) return setErr("Paste the link to the finished design.");
    mutate((x) => ({ ...x, status: "completed", finalLink: finalLink.trim(), completedAt: new Date().toISOString() }), "Completed · " + finalLink.trim());
    setAction(null);
  };

  const reopen = (to) => mutate((x) => ({ ...x, status: to }), "Reopened → " + STATUS[to].label);

  const addComment = () => {
    const text = comment.trim();
    if (!text) return;
    mutate((x) => ({ ...x, comments: [...(x.comments || []), { id: uid(), authorId: user.id, authorName: user.name, text, at: new Date().toISOString() }] }));
    setComment("");
  };

  const st = STATUS[c.status] || STATUS.requested;

  return (
    <div className="card commission" style={{ margin: 0 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h2 style={{ marginBottom: 2 }}>{c.cardName || "Untitled card"}</h2>
          <div className="muted small">Card ID: <b style={{ color: "var(--text-2)" }}>{c.cardId || "—"}</b></div>
        </div>
        <span className={"badge " + st.cls}>{st.label}</span>
      </div>

      {c.notes && <div className="mt small" style={{ color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{c.notes}</div>}

      <div className="mt row" style={{ gap: 18, fontSize: 12, color: "var(--text-3)" }}>
        <span>Requested by <Who name={c.requestedByName} badges={badgesOf(c.requestedById)} /> · {shortDate(c.requestedAt)}</span>
        {c.assigneeName && <span>Artist: <Who name={c.assigneeName} badges={badgesOf(c.assigneeId)} /></span>}
      </div>

      {c.cardImage && (
        <div className="mt">
          <img src={c.cardImage} alt={c.cardName} className="commission-thumb" onClick={() => setLightbox(true)} title="Click to enlarge" />
        </div>
      )}

      {c.status === "denied" && c.denyReason && <div className="notice bad mt">Denied: {c.denyReason}</div>}
      {c.status === "completed" && c.finalLink && (
        <div className="notice good mt">
          ✅ Finished design: <a href={c.finalLink} target="_blank" rel="noreferrer">{c.finalLink}</a>
        </div>
      )}

      {err && <div className="notice bad mt">⚠️ {err}</div>}

      {/* ---- actions ---- */}
      <div className="mt row">
        {c.status === "requested" && isAdmin && !action && (
          <>
            <button className="btn primary small" onClick={() => setAction("approve")}>Approve &amp; upload card</button>
            <button className="btn danger small" onClick={() => setAction("deny")}>Deny</button>
          </>
        )}
        {c.status === "approved" && isArtist && <button className="btn primary small" onClick={start}>Start work</button>}
        {c.status === "in_progress" && isArtist && !action && <button className="btn primary small" onClick={() => setAction("complete")}>Mark complete</button>}
        {c.status === "denied" && isAdmin && <button className="btn small" onClick={() => reopen("requested")}>Reopen</button>}
        {c.status === "completed" && isAdmin && <button className="btn small" onClick={() => reopen("in_progress")}>Reopen</button>}
      </div>

      {action === "approve" && (
        <div className="notice mt">
          <label className="field">
            <span className="lab">Card image (PNG)</span>
            <input type="file" accept="image/png,image/jpeg" onChange={(e) => setFile(e.target.files[0])} />
          </label>
          <label className="field">
            <span className="lab">Assign to artist</span>
            <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {db.users.map((u) => (
                <option key={u.id} value={u.id}>{u.name}{(u.badges || []).includes("Artist") ? " (Artist)" : ""}</option>
              ))}
            </select>
          </label>
          <div className="row">
            <button className="btn primary small" onClick={approve} disabled={busy}>{busy ? "Uploading…" : "Confirm approval"}</button>
            <button className="btn small" onClick={() => { setAction(null); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {action === "deny" && (
        <div className="notice mt">
          <label className="field">
            <span className="lab">Reason (optional)</span>
            <textarea value={denyReason} onChange={(e) => setDenyReason(e.target.value)} placeholder="e.g. can't source a clean scan of this card" />
          </label>
          <div className="row">
            <button className="btn danger small" onClick={deny}>Confirm deny</button>
            <button className="btn small" onClick={() => setAction(null)}>Cancel</button>
          </div>
        </div>
      )}

      {action === "complete" && (
        <div className="notice mt">
          <label className="field">
            <span className="lab">Link to finished design</span>
            <input type="text" value={finalLink} onChange={(e) => setFinalLink(e.target.value)} placeholder="https://…" />
          </label>
          <div className="row">
            <button className="btn primary small" onClick={complete}>Submit &amp; complete</button>
            <button className="btn small" onClick={() => { setAction(null); setErr(null); }}>Cancel</button>
          </div>
        </div>
      )}

      {/* ---- comments ---- */}
      <div className="mt" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <h3 style={{ marginBottom: 8 }}>Notes &amp; comments ({(c.comments || []).length})</h3>
        {(c.comments || []).map((cm) => (
          <div key={cm.id} className="comment">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <Who name={cm.authorName} badges={badgesOf(cm.authorId)} />
              <span className="muted" style={{ fontSize: 11 }}>{shortDate(cm.at)}</span>
            </div>
            <div className="small" style={{ marginTop: 3, whiteSpace: "pre-wrap", color: "var(--text-2)" }}>{cm.text}</div>
          </div>
        ))}
        <div className="row mt" style={{ alignItems: "flex-start" }}>
          <input type="text" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a note…" onKeyDown={(e) => { if (e.key === "Enter") addComment(); }} />
          <button className="btn small" onClick={addComment}>Post</button>
        </div>
      </div>

      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(false)}>
          <img src={c.cardImage} alt={c.cardName} />
        </div>
      )}
    </div>
  );
}

export default function CommissionsPage({ db, update, user }) {
  const [filter, setFilter] = useState("open");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ cardName: "", cardId: "", notes: "" });

  const submit = (e) => {
    e.preventDefault();
    if (!form.cardName.trim()) return;
    const rec = {
      id: uid(),
      cardName: form.cardName.trim(),
      cardId: form.cardId.trim(),
      notes: form.notes.trim(),
      status: "requested",
      requestedById: user.id,
      requestedByName: user.name,
      requestedAt: new Date().toISOString(),
      comments: [],
      history: [{ at: new Date().toISOString(), byName: user.name, action: "Requested" }],
    };
    update((d) => ({ ...d, commissions: [rec, ...d.commissions] }));
    setForm({ cardName: "", cardId: "", notes: "" });
    setShowForm(false);
  };

  const shown = useMemo(() => {
    const list = db.commissions || [];
    if (filter === "all") return list;
    if (filter === "open") return list.filter((c) => c.status !== "completed" && c.status !== "denied");
    return list.filter((c) => c.status === filter);
  }, [db.commissions, filter]);

  if (!db.commissionsReady) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Commissions</h1></div></div>
        <div className="card">
          <h2>One-time database step needed</h2>
          <p className="muted">
            Commissions store their data in new tables your Supabase project doesn't have yet. Open Supabase →
            <b> SQL Editor</b> → New query, paste the snippet below, hit <b>Run</b>, then refresh.
            (Also in the repo at <code>supabase/migrations/2026-07-commissions.sql</code>.)
          </p>
          <pre style={{ background: "var(--panel-2)", padding: 14, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{`alter table public.profiles add column if not exists badges jsonb not null default '[]'::jsonb;

create table if not exists public.commissions (
  id text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.commissions enable row level security;
create policy "team full access" on public.commissions
  for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.commissions;`}</pre>
        </div>
      </div>
    );
  }

  const counts = (db.commissions || []).reduce((m, c) => { m[c.status] = (m[c.status] || 0) + 1; return m; }, {});

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Commissions</h1>
          <div className="sub">Custom card artwork — from request, through approval, to the finished design.</div>
        </div>
        <button className="btn primary" onClick={() => setShowForm(!showForm)}>{showForm ? "Cancel" : "+ New request"}</button>
      </div>

      {showForm && (
        <form className="card mb" onSubmit={submit}>
          <h2>New commission request</h2>
          <div className="form-row">
            <label className="field" style={{ flex: 2 }}>
              <span className="lab">Card name</span>
              <input type="text" value={form.cardName} onChange={(e) => setForm({ ...form, cardName: e.target.value })} placeholder="e.g. Charizard VMAX (Rainbow)" autoFocus />
            </label>
            <label className="field">
              <span className="lab">Card ID / set number</span>
              <input type="text" value={form.cardId} onChange={(e) => setForm({ ...form, cardId: e.target.value })} placeholder="e.g. SWSH050" />
            </label>
          </div>
          <label className="field">
            <span className="lab">Notes (optional)</span>
            <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Anything the artist should know — style, deadline, customer request…" />
          </label>
          <button className="btn primary">Submit request</button>
        </form>
      )}

      <div className="pills mb">
        {FILTERS.map(([k, l]) => (
          <button key={k} className={filter === k ? "active" : ""} onClick={() => setFilter(k)}>
            {l}{k !== "open" && k !== "all" && counts[k] ? ` (${counts[k]})` : ""}
          </button>
        ))}
      </div>

      <div className="commission-grid">
        {shown.map((c) => (
          <CommissionCard key={c.id} c={c} db={db} user={user} update={update} />
        ))}
        {!shown.length && (
          <div className="card" style={{ textAlign: "center", padding: 34 }}>
            <div className="muted">{db.commissions.length ? "Nothing in this view." : "No commission requests yet. Click “+ New request” to add the first one."}</div>
          </div>
        )}
      </div>
    </div>
  );
}
