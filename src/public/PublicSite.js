import React, { useEffect, useMemo, useState } from "react";
import { money, pct, shortDate } from "../lib/format";
import { verifyDraw } from "../lib/raffle";
import "./public.css";

const logo = process.env.PUBLIC_URL + "/brand/logo-light@2x.png";

function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const navigate = (to) => {
    window.history.pushState({}, "", to);
    setPath(to);
    window.scrollTo(0, 0);
  };
  return { path, navigate };
}

function Countdown({ closesAt }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (!closesAt) return null;
  const end = new Date(closesAt + "T23:59:59").getTime();
  let ms = end - now;
  if (ms <= 0) return <span className="pub-count closed">Entries closed</span>;
  const d = Math.floor(ms / 86400000);
  ms -= d * 86400000;
  const h = Math.floor(ms / 3600000);
  ms -= h * 3600000;
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const box = (v, l) => (
    <span className="pub-count-box"><b>{String(v).padStart(2, "0")}</b><i>{l}</i></span>
  );
  return (
    <span className="pub-count">
      {box(d, "days")}{box(h, "hrs")}{box(m, "min")}{box(s, "sec")}
    </span>
  );
}

function Progress({ sold, max }) {
  const p = max ? Math.min(100, (sold / max) * 100) : 0;
  return (
    <div className="pub-progress">
      <div className="pub-progress-bar" style={{ width: p + "%" }} />
      <div className="pub-progress-label">
        <span>{sold} / {max} entries</span>
        <span>{pct(p, 0)} sold</span>
      </div>
    </div>
  );
}

function Header({ navigate }) {
  return (
    <header className="pub-header">
      <div className="pub-wrap pub-header-inner">
        <a href="/raffles" onClick={(e) => { e.preventDefault(); navigate("/raffles"); }}>
          <img src={logo} alt="KantoForge" />
        </a>
        <nav>
          <a href="https://kantoforge.com" target="_blank" rel="noreferrer">Shop</a>
          <a href="/raffles" onClick={(e) => { e.preventDefault(); navigate("/raffles"); }}>Competitions</a>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="pub-footer">
      <div className="pub-wrap">
        <p><b>Prize competitions, not a lottery.</b> Every competition requires a question of skill and offers a free postal entry route. Open to UK residents aged 18+. Please play responsibly.</p>
        <p className="pub-muted">© KantoForge. Winners drawn using a published, independently-verifiable provably-fair method.</p>
      </div>
    </footer>
  );
}

function CompCard({ c, navigate }) {
  const open = c.status === "open";
  const drawn = c.status === "drawn";
  return (
    <button className="pub-card" onClick={() => navigate("/raffles/" + c.id)}>
      <div className="pub-card-img">
        {c.prizeImage ? <img src={c.prizeImage} alt={c.title} /> : <div className="pub-card-noimg">🃏</div>}
        <span className={"pub-status " + c.status}>{drawn ? "Winner drawn" : open ? "Live" : "Closed"}</span>
      </div>
      <div className="pub-card-body">
        <h3>{c.title}</h3>
        {!drawn && <Progress sold={c.ticketsSold} max={c.maxTickets} />}
        {drawn && c.draw && <div className="pub-winner-chip">🏆 {c.draw.winnerName} · #{c.draw.winningTicket}</div>}
        <div className="pub-card-foot">
          <span className="pub-price">{money(c.ticketPrice)}<i>/ entry</i></span>
          {open && c.closesAt && <span className="pub-muted">ends {shortDate(c.closesAt)}</span>}
        </div>
      </div>
    </button>
  );
}

function ListView({ comps, navigate }) {
  const live = comps.filter((c) => c.status === "open");
  const closed = comps.filter((c) => c.status === "closed");
  const drawn = comps.filter((c) => c.status === "drawn");
  return (
    <>
      <section className="pub-hero">
        <div className="pub-wrap">
          <h1>Win graded slabs &amp; sealed grails.</h1>
          <p>Skill-based prize competitions from KantoForge. Low ticket prices, real cards, and a draw you can verify yourself.</p>
          <div className="pub-trust">
            <span>🔒 Provably-fair draws</span>
            <span>🎟️ Free postal entry</span>
            <span>🇬🇧 UK 18+</span>
          </div>
        </div>
      </section>
      <div className="pub-wrap">
        {!comps.length && <div className="pub-empty">No competitions are live right now — check back soon.</div>}
        {!!live.length && <><h2 className="pub-section">Live now</h2><div className="pub-grid">{live.map((c) => <CompCard key={c.id} c={c} navigate={navigate} />)}</div></>}
        {!!closed.length && <><h2 className="pub-section">Closed — draw pending</h2><div className="pub-grid">{closed.map((c) => <CompCard key={c.id} c={c} navigate={navigate} />)}</div></>}
        {!!drawn.length && <><h2 className="pub-section">Past winners</h2><div className="pub-grid">{drawn.map((c) => <CompCard key={c.id} c={c} navigate={navigate} />)}</div></>}
      </div>
    </>
  );
}

function Fairness({ c }) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const drawn = c.status === "drawn" && c.draw;
  const run = async () => {
    setBusy(true);
    const r = await verifyDraw({
      serverSeed: c.draw.revealedSeed,
      serverSeedHash: c.serverSeedHash,
      publicEntropy: c.draw.publicEntropy,
      ticketsTotal: c.draw.ticketsTotal,
      winningTicket: c.draw.winningTicket,
    });
    setResult(r);
    setBusy(false);
  };
  return (
    <div className="pub-fair">
      <h3>🔒 Provably fair</h3>
      <p className="pub-muted">
        Before entries opened we published the SHA-256 hash of a secret seed, locking the result in advance. {drawn ? "The seed is now revealed — verify below." : "After the draw the seed is revealed so anyone can confirm the winner was not chosen."}
      </p>
      <div className="pub-hashrow"><span>Committed hash</span><code>{c.serverSeedHash}</code></div>
      {drawn && (
        <>
          <div className="pub-hashrow"><span>Revealed seed</span><code>{c.draw.revealedSeed}</code></div>
          {c.draw.publicEntropy && <div className="pub-hashrow"><span>Public entropy</span><code>{c.draw.publicEntropy}</code></div>}
          <div className="pub-hashrow"><span>Winning number</span><code>#{c.draw.winningTicket} of {c.draw.ticketsTotal}</code></div>
          <button className="pub-btn ghost" onClick={run} disabled={busy}>{busy ? "Checking…" : "Verify this draw in your browser"}</button>
          {result && (
            <div className={"pub-verify " + (result.commitOk && result.ticketOk ? "ok" : "bad")}>
              {result.commitOk && result.ticketOk
                ? "✓ Verified — the revealed seed matches the published hash, and the winning number recomputes exactly."
                : "✗ Verification failed."}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function DetailView({ c, navigate }) {
  const [answer, setAnswer] = useState(null);
  const open = c.status === "open";
  const drawn = c.status === "drawn";
  return (
    <div className="pub-wrap pub-detail">
      <button className="pub-back" onClick={() => navigate("/raffles")}>← All competitions</button>
      <div className="pub-detail-grid">
        <div className="pub-detail-img">
          {c.prizeImage ? <img src={c.prizeImage} alt={c.title} /> : <div className="pub-card-noimg big">🃏</div>}
        </div>
        <div className="pub-detail-info">
          <span className={"pub-status " + c.status}>{drawn ? "Winner drawn" : open ? "Live" : "Closed"}</span>
          <h1>{c.title}</h1>
          {c.prize && <p className="pub-prize">{c.prize}</p>}

          {!drawn && <Progress sold={c.ticketsSold} max={c.maxTickets} />}
          {open && c.closesAt && <div className="pub-count-wrap"><span className="pub-muted">Entries close in</span><Countdown closesAt={c.closesAt} /></div>}

          {drawn && c.draw && (
            <div className="pub-winner-banner">🏆 Winner: <b>{c.draw.winnerName}</b> — ticket #{c.draw.winningTicket}</div>
          )}

          <div className="pub-price-big">{money(c.ticketPrice)} <i>per entry</i></div>

          {open && (
            <div className="pub-enter">
              <h3>Answer to enter</h3>
              <p className="pub-question">{c.question}</p>
              <div className="pub-answers">
                {c.answers.map((a, i) => (
                  <button key={i} className={"pub-answer" + (answer === i ? " sel" : "")} onClick={() => setAnswer(i)}>{a}</button>
                ))}
              </div>
              <button className="pub-btn primary" disabled title="Paid entries are coming soon">
                {answer == null ? "Select your answer" : "Enter — coming soon"}
              </button>
              <p className="pub-muted pub-soon">Paid entries aren't live yet. This is a preview of the competition page.</p>
            </div>
          )}

          {c.freeEntryInfo && (
            <details className="pub-free">
              <summary>Free postal entry (no purchase necessary)</summary>
              <p>{c.freeEntryInfo}</p>
            </details>
          )}
        </div>
      </div>
      <Fairness c={c} />
    </div>
  );
}

export default function PublicSite() {
  const { path, navigate } = useRoute();
  const [comps, setComps] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/api/public-competitions")
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok && d.configured === false) setError("The competitions site isn't switched on yet. Check back soon!");
        setComps(d.competitions || []);
      })
      .catch(() => setError("Couldn't load competitions right now. Please try again shortly."));
  }, []);

  const detailId = useMemo(() => {
    const m = path.match(/^\/raffles\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }, [path]);

  const detail = detailId && comps ? comps.find((c) => c.id === detailId) : null;

  return (
    <div className="pub-root">
      <Header navigate={navigate} />
      <main>
        {comps === null && !error && <div className="pub-wrap pub-empty">Loading competitions…</div>}
        {error && <div className="pub-wrap pub-empty">{error}</div>}
        {comps && !error && detailId && !detail && (
          <div className="pub-wrap pub-empty">That competition isn't available. <a href="/raffles" onClick={(e) => { e.preventDefault(); navigate("/raffles"); }}>See all competitions →</a></div>
        )}
        {comps && !error && detail && <DetailView c={detail} navigate={navigate} />}
        {comps && !error && !detailId && <ListView comps={comps} navigate={navigate} />}
      </main>
      <Footer />
    </div>
  );
}
