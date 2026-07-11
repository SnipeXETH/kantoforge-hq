import React, { useMemo, useState } from "react";
import { uid, shortDate, money, pct } from "../lib/format";
import { fileToResizedDataUrl } from "../lib/image";
import { randomSeedHex, sha256hex, allocateTickets, ownerOfTicket, deriveWinningTicket, verifyDraw } from "../lib/raffle";

const STATUS = {
  draft: { label: "Draft", cls: "gray" },
  open: { label: "Open", cls: "green" },
  closed: { label: "Closed", cls: "yellow" },
  drawn: { label: "Drawn", cls: "violet" },
};

const MIGRATION_SQL = `create table if not exists public.competitions (
  id text primary key, data jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.raffle_entries (
  id text primary key, competition_id text, data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.competitions enable row level security;
alter table public.raffle_entries enable row level security;
create policy "team full access" on public.competitions
  for all to authenticated using (true) with check (true);
create policy "team full access" on public.raffle_entries
  for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.competitions, public.raffle_entries;`;

function entriesFor(db, compId) {
  return db.raffleEntries
    .filter((e) => e.competitionId === compId)
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || "") || a.id.localeCompare(b.id));
}

// ---- create form ----------------------------------------------------------
function CreateForm({ user, update, onDone }) {
  const [f, setF] = useState({ title: "", prize: "", ticketPrice: "4.99", maxTickets: "500", closesAt: "", question: "", answers: ["", "", "", ""], correct: 0, freeEntryInfo: "" });
  const [image, setImage] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const setAnswer = (i, v) => setF({ ...f, answers: f.answers.map((a, j) => (j === i ? v : a)) });

  const create = async (e) => {
    e.preventDefault();
    setErr(null);
    if (!f.title.trim()) return setErr("Give the competition a title.");
    const answers = f.answers.map((a) => a.trim()).filter(Boolean);
    if (!f.question.trim() || answers.length < 2) return setErr("Add a skill question with at least two answers.");
    if (f.correct >= answers.length) return setErr("Pick which answer is correct.");
    setBusy(true);
    try {
      const serverSeed = randomSeedHex();
      const serverSeedHash = await sha256hex(serverSeed);
      let prizeImage = null;
      if (image) prizeImage = await fileToResizedDataUrl(image);
      const comp = {
        id: uid(),
        title: f.title.trim(),
        prize: f.prize.trim(),
        prizeImage,
        ticketPrice: parseFloat(f.ticketPrice) || 0,
        maxTickets: parseInt(f.maxTickets) || 0,
        closesAt: f.closesAt || null,
        question: f.question.trim(),
        answers,
        correct: f.correct,
        freeEntryInfo: f.freeEntryInfo.trim(),
        status: "draft",
        serverSeed, // hidden in UI until the draw reveals it
        serverSeedHash,
        createdById: user.id,
        createdByName: user.name,
        createdAt: new Date().toISOString(),
      };
      update((d) => ({ ...d, competitions: [comp, ...d.competitions] }));
      onDone(comp.id);
    } catch (e2) {
      setErr(e2.message || String(e2));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="card mb" onSubmit={create}>
      <h2>New competition</h2>
      {err && <div className="notice bad mt mb">⚠️ {err}</div>}
      <div className="form-row">
        <label className="field" style={{ flex: 2 }}>
          <span className="lab">Title</span>
          <input type="text" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. PSA 10 Charizard Base Set" autoFocus />
        </label>
        <label className="field">
          <span className="lab">Ticket price (£)</span>
          <input type="number" step="0.01" value={f.ticketPrice} onChange={(e) => setF({ ...f, ticketPrice: e.target.value })} />
        </label>
        <label className="field">
          <span className="lab">Max tickets</span>
          <input type="number" value={f.maxTickets} onChange={(e) => setF({ ...f, maxTickets: e.target.value })} />
        </label>
        <label className="field">
          <span className="lab">Closes</span>
          <input type="date" value={f.closesAt} onChange={(e) => setF({ ...f, closesAt: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span className="lab">Prize description</span>
        <textarea value={f.prize} onChange={(e) => setF({ ...f, prize: e.target.value })} placeholder="Grade, cert number, condition notes…" />
      </label>
      <label className="field">
        <span className="lab">Prize photo (optional)</span>
        <input type="file" accept="image/png,image/jpeg" onChange={(e) => setImage(e.target.files[0])} />
      </label>

      <h3 style={{ margin: "16px 0 8px" }}>Skill question <span className="muted" style={{ textTransform: "none", letterSpacing: 0 }}>(required to be a competition, not a lottery)</span></h3>
      <label className="field">
        <span className="lab">Question</span>
        <input type="text" value={f.question} onChange={(e) => setF({ ...f, question: e.target.value })} placeholder="e.g. In which year was the Pokémon Base Set first released in the UK?" />
      </label>
      <div className="form-row" style={{ flexWrap: "wrap" }}>
        {f.answers.map((a, i) => (
          <label className="field" key={i} style={{ minWidth: 150 }}>
            <span className="lab" style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <input type="radio" name="correct" checked={f.correct === i} onChange={() => setF({ ...f, correct: i })} style={{ width: "auto" }} />
              Answer {i + 1}{f.correct === i ? " ✓ correct" : ""}
            </span>
            <input type="text" value={a} onChange={(e) => setAnswer(i, e.target.value)} />
          </label>
        ))}
      </div>
      <label className="field">
        <span className="lab">Free entry route (no-purchase alternative)</span>
        <textarea value={f.freeEntryInfo} onChange={(e) => setF({ ...f, freeEntryInfo: e.target.value })} placeholder="e.g. postal entry address and instructions — required for a compliant free prize draw" />
      </label>

      <div className="row">
        <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create competition"}</button>
        <button type="button" className="btn" onClick={() => onDone(null)}>Cancel</button>
      </div>
      <div className="notice mt small">
        On create, a random draw seed is generated and its SHA-256 hash is committed — locking the outcome's fairness in
        advance. The seed stays hidden until you run the draw.
      </div>
    </form>
  );
}

// ---- detail view -----------------------------------------------------------
function CompetitionDetail({ comp, db, user, update, onBack }) {
  const isAdmin = user.role === "admin";
  const [entry, setEntry] = useState({ name: "", email: "", quantity: "1", answeredCorrectly: true });
  const [entropy, setEntropy] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [verify, setVerify] = useState(null);
  const [showSeed, setShowSeed] = useState(false);

  const entries = entriesFor(db, comp.id);
  const { ranges, total } = useMemo(() => allocateTickets(entries), [entries]);
  const soldPct = comp.maxTickets ? (total / comp.maxTickets) * 100 : 0;

  const setComp = (fn, note) =>
    update((d) => ({
      ...d,
      competitions: d.competitions.map((c) => {
        if (c.id !== comp.id) return c;
        const next = fn({ ...c });
        next.updatedAt = new Date().toISOString();
        if (note) next.history = [...(c.history || []), { at: next.updatedAt, byName: user.name, action: note }];
        return next;
      }),
    }));

  const addEntry = (e) => {
    e.preventDefault();
    if (!entry.name.trim()) return;
    const rec = {
      id: uid(),
      competitionId: comp.id,
      name: entry.name.trim(),
      email: entry.email.trim(),
      quantity: Math.max(1, parseInt(entry.quantity) || 1),
      answeredCorrectly: entry.answeredCorrectly,
      source: "manual",
      createdAt: new Date().toISOString(),
    };
    update((d) => ({ ...d, raffleEntries: [...d.raffleEntries, rec] }));
    setEntry({ name: "", email: "", quantity: "1", answeredCorrectly: true });
  };

  const removeEntry = (id) => update((d) => ({ ...d, raffleEntries: d.raffleEntries.filter((x) => x.id !== id) }));

  const setStatus = (status, note) => setComp((c) => ({ ...c, status }), note);

  const runDraw = async () => {
    setErr(null);
    if (total < 1) return setErr("No entries to draw from.");
    setBusy(true);
    try {
      const orderedEntryIds = entries.map((e) => e.id);
      const { finalHash, winningTicket } = await deriveWinningTicket(comp.serverSeed, entropy.trim(), total);
      const owner = ownerOfTicket(ranges, winningTicket);
      setComp(
        (c) => ({
          ...c,
          status: "drawn",
          draw: {
            drawnAt: new Date().toISOString(),
            drawnByName: user.name,
            publicEntropy: entropy.trim(),
            ticketsTotal: total,
            orderedEntryIds,
            finalHash,
            winningTicket,
            winnerEntryId: owner ? owner.entryId : null,
            winnerName: owner ? owner.name : "(unknown)",
            revealedSeed: comp.serverSeed,
          },
        }),
        "Drew winner: ticket #" + winningTicket + " → " + (owner ? owner.name : "?")
      );
    } catch (e2) {
      setErr(e2.message || String(e2));
    } finally {
      setBusy(false);
    }
  };

  const doVerify = async () => {
    const dr = comp.draw;
    const res = await verifyDraw({
      serverSeed: dr.revealedSeed,
      serverSeedHash: comp.serverSeedHash,
      publicEntropy: dr.publicEntropy,
      ticketsTotal: dr.ticketsTotal,
      winningTicket: dr.winningTicket,
    });
    setVerify(res);
  };

  const st = STATUS[comp.status] || STATUS.draft;
  const drawn = comp.status === "drawn";

  return (
    <div>
      <button className="btn small mb" onClick={onBack}>← All competitions</button>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{comp.title}</h1>
            <div className="muted small">
              {money(comp.ticketPrice)} / ticket · max {comp.maxTickets} · {comp.closesAt ? "closes " + shortDate(comp.closesAt) : "no close date"}
            </div>
          </div>
          <span className={"badge " + st.cls}>{st.label}</span>
        </div>
        {comp.prizeImage && <img src={comp.prizeImage} alt={comp.title} className="commission-thumb mt" />}
        {comp.prize && <div className="mt small" style={{ color: "var(--text-2)", whiteSpace: "pre-wrap" }}>{comp.prize}</div>}

        <div className="grid kpis mt">
          <div className="kpi" style={{ background: "var(--panel-2)" }}>
            <div className="label">Tickets sold</div>
            <div className="value">{total}<span className="muted" style={{ fontSize: 14 }}> / {comp.maxTickets}</span></div>
            <div className="delta">{pct(soldPct)} of cap</div>
          </div>
          <div className="kpi" style={{ background: "var(--panel-2)" }}>
            <div className="label">Gross entries value</div>
            <div className="value">{money(total * comp.ticketPrice)}</div>
          </div>
          <div className="kpi" style={{ background: "var(--panel-2)" }}>
            <div className="label">Entrants</div>
            <div className="value">{entries.length}</div>
          </div>
        </div>

        {isAdmin && (
          <div className="row mt">
            {comp.status === "draft" && <button className="btn primary small" onClick={() => setStatus("open", "Opened entries")}>Open entries</button>}
            {comp.status === "open" && <button className="btn small" onClick={() => setStatus("closed", "Closed entries")}>Close entries</button>}
            {comp.status === "closed" && <button className="btn small" onClick={() => setStatus("open", "Reopened entries")}>Reopen</button>}
            <span className="spacer" />
            <button
              className={"btn small " + (comp.isPublic ? "primary" : "")}
              onClick={() => setComp((c) => ({ ...c, isPublic: !c.isPublic }), comp.isPublic ? "Hidden from public site" : "Published to public site")}
            >
              {comp.isPublic ? "● Live on public site" : "○ Publish to public site"}
            </button>
          </div>
        )}
        {comp.isPublic && (
          <div className="notice good mt small">
            🌐 Public page: <a href={window.location.origin + "/raffles/" + comp.id} target="_blank" rel="noreferrer">{window.location.origin}/raffles/{comp.id}</a>
            {comp.status === "draft" && <span className="muted"> — publishes once you open entries (drafts stay hidden).</span>}
          </div>
        )}
      </div>

      {/* fairness commit */}
      <div className="card mt">
        <h2>Provably-fair draw</h2>
        <div className="card-sub">The winning ticket is derived from a seed committed before entries opened — verifiable, not editable.</div>
        <table className="data">
          <tbody>
            <tr><td>Committed seed hash (SHA-256)</td><td className="num" style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{comp.serverSeedHash}</td></tr>
            {!drawn && (
              <tr>
                <td>Seed</td>
                <td className="num muted">Hidden until the draw — {showSeed && isAdmin ? <code style={{ fontSize: 11 }}>{comp.serverSeed}</code> : <button className="btn small" onClick={() => setShowSeed(!showSeed)}>{showSeed ? "hide" : "admin peek"}</button>}</td>
              </tr>
            )}
          </tbody>
        </table>

        {comp.status === "closed" && isAdmin && !drawn && (
          <div className="notice mt">
            <label className="field">
              <span className="lab">Public entropy (optional but recommended)</span>
              <input type="text" value={entropy} onChange={(e) => setEntropy(e.target.value)} placeholder="e.g. UK Lotto numbers for Sat 12 Jul 2026 — a value you can't control" />
              <span className="hint">Folding in a public future value proves the seed wasn't chosen to hit a particular winner.</span>
            </label>
            {err && <div className="notice bad mb">⚠️ {err}</div>}
            <button className="btn primary" onClick={runDraw} disabled={busy}>{busy ? "Drawing…" : "🎲 Run the draw"}</button>
          </div>
        )}
        {comp.status === "open" && <div className="notice mt small">Close entries before drawing.</div>}
        {comp.status === "draft" && <div className="notice mt small">Open, then close entries before drawing.</div>}

        {drawn && comp.draw && (
          <div className="notice good mt">
            <h3 style={{ marginBottom: 6 }}>🏆 Winner: {comp.draw.winnerName} — ticket #{comp.draw.winningTicket}</h3>
            <div className="small muted">Drawn {shortDate(comp.draw.drawnAt)} by {comp.draw.drawnByName} · {comp.draw.ticketsTotal} tickets</div>
            <table className="data mt">
              <tbody>
                <tr><td>Revealed seed</td><td className="num" style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{comp.draw.revealedSeed}</td></tr>
                <tr><td>Public entropy</td><td className="num">{comp.draw.publicEntropy || "—"}</td></tr>
                <tr><td>Final hash</td><td className="num" style={{ fontFamily: "monospace", fontSize: 11, wordBreak: "break-all" }}>{comp.draw.finalHash}</td></tr>
                <tr><td>Winning number</td><td className="num"><b>#{comp.draw.winningTicket}</b> of {comp.draw.ticketsTotal}</td></tr>
              </tbody>
            </table>
            <div className="row mt">
              <button className="btn small" onClick={doVerify}>Verify this draw</button>
              {verify && (
                <span className={verify.commitOk && verify.ticketOk ? "badge green" : "badge red"}>
                  {verify.commitOk && verify.ticketOk ? "✓ Seed matches commit & winner recomputes" : "✗ Verification failed"}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* entries */}
      <div className="card mt">
        <h2>Entries &amp; tickets ({total})</h2>
        {isAdmin && !drawn && (
          <form className="form-row mb" onSubmit={addEntry} style={{ alignItems: "flex-end", flexWrap: "wrap" }}>
            <label className="field" style={{ flex: 2, minWidth: 140 }}>
              <span className="lab">Name</span>
              <input type="text" value={entry.name} onChange={(e) => setEntry({ ...entry, name: e.target.value })} />
            </label>
            <label className="field" style={{ flex: 2, minWidth: 160 }}>
              <span className="lab">Email</span>
              <input type="email" value={entry.email} onChange={(e) => setEntry({ ...entry, email: e.target.value })} />
            </label>
            <label className="field" style={{ minWidth: 90 }}>
              <span className="lab">Tickets</span>
              <input type="number" min="1" value={entry.quantity} onChange={(e) => setEntry({ ...entry, quantity: e.target.value })} />
            </label>
            <label className="field" style={{ minWidth: 130 }}>
              <span className="lab">Skill answer</span>
              <select value={entry.answeredCorrectly ? "1" : "0"} onChange={(e) => setEntry({ ...entry, answeredCorrectly: e.target.value === "1" })}>
                <option value="1">Correct</option>
                <option value="0">Wrong</option>
              </select>
            </label>
            <button className="btn primary" style={{ marginBottom: 12 }}>Add entry</button>
          </form>
        )}
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr><th>Entrant</th><th className="num">Tickets</th><th className="num">Numbers</th><th className="num">Odds</th><th>Skill</th><th>Source</th>{isAdmin && !drawn && <th></th>}</tr>
            </thead>
            <tbody>
              {ranges.map((r) => {
                const e = entries.find((x) => x.id === r.entryId);
                const isWinner = drawn && comp.draw.winnerEntryId === r.entryId;
                return (
                  <tr key={r.entryId} style={isWinner ? { background: "rgba(12,163,12,0.1)" } : undefined}>
                    <td><b>{e.name}</b>{isWinner ? <span className="badge green" style={{ marginLeft: 6 }}>WINNER</span> : null}{e.email ? <div className="muted small">{e.email}</div> : null}</td>
                    <td className="num">{r.quantity}</td>
                    <td className="num">{r.from === r.to ? r.from : r.from + "–" + r.to}</td>
                    <td className="num">{pct((r.quantity / total) * 100)}</td>
                    <td>{e.answeredCorrectly ? <span className="badge green">✓</span> : <span className="badge red">✗</span>}</td>
                    <td><span className="badge gray">{e.source}</span></td>
                    {isAdmin && !drawn && <td className="num"><button className="btn small danger" onClick={() => removeEntry(r.entryId)}>✕</button></td>}
                  </tr>
                );
              })}
              {!ranges.length && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export default function RafflesPage({ db, update, user }) {
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const isAdmin = user.role === "admin";

  if (!db.rafflesReady) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>Competitions</h1></div></div>
        <div className="card">
          <h2>One-time database step needed</h2>
          <p className="muted">Paste this into Supabase → SQL Editor → Run, then refresh. (Also at <code>supabase/migrations/2026-07-raffles.sql</code>.)</p>
          <pre style={{ background: "var(--panel-2)", padding: 14, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{MIGRATION_SQL}</pre>
        </div>
      </div>
    );
  }

  const comp = selected ? db.competitions.find((c) => c.id === selected) : null;

  return (
    <div className="page">
      {!comp && (
        <>
          <div className="page-head">
            <div>
              <h1>Competitions</h1>
              <div className="sub">Skill-based prize competitions with a provably-fair draw. Payments &amp; public pages come next — this is the engine.</div>
            </div>
            <div className="row">
              <a className="btn" href={window.location.origin + "/raffles"} target="_blank" rel="noreferrer">🌐 Preview public site</a>
              {isAdmin && <button className="btn primary" onClick={() => setCreating(!creating)}>{creating ? "Cancel" : "+ New competition"}</button>}
            </div>
          </div>

          <div className="notice mb small">
            ⚖️ These build the mechanics of a skill competition (skill question, free-entry route, provably-fair draw). Before
            running one for real money, have a UK prize-competition solicitor review your setup — this isn't legal advice.
          </div>

          {creating && <CreateForm user={user} update={update} onDone={(id) => { setCreating(false); if (id) setSelected(id); }} />}

          <div className="commission-grid">
            {db.competitions.map((c) => {
              const total = allocateTickets(entriesFor(db, c.id)).total;
              const st = STATUS[c.status] || STATUS.draft;
              return (
                <div key={c.id} className="card" style={{ margin: 0, cursor: "pointer" }} onClick={() => setSelected(c.id)}>
                  <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                    <h2 style={{ marginBottom: 2 }}>{c.title}</h2>
                    <span className={"badge " + st.cls}>{st.label}</span>
                  </div>
                  <div className="muted small">{money(c.ticketPrice)} / ticket · {total} / {c.maxTickets} sold</div>
                  {c.status === "drawn" && c.draw && <div className="notice good mt small">🏆 {c.draw.winnerName} — #{c.draw.winningTicket}</div>}
                </div>
              );
            })}
            {!db.competitions.length && !creating && (
              <div className="card" style={{ textAlign: "center", padding: 34 }}>
                <div className="muted">No competitions yet.{isAdmin ? " Click “+ New competition”." : ""}</div>
              </div>
            )}
          </div>
        </>
      )}

      {comp && <CompetitionDetail comp={comp} db={db} user={user} update={update} onBack={() => { setSelected(null); }} />}
    </div>
  );
}
