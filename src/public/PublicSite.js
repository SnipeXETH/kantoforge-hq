import React, { useEffect, useMemo, useState } from "react";
import { money, pct, shortDate } from "../lib/format";
import { verifyWinners } from "../lib/raffle";
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
          <a href="/raffles/how-it-works" onClick={(e) => { e.preventDefault(); navigate("/raffles/how-it-works"); }}>How draws work</a>
        </nav>
      </div>
    </header>
  );
}

// Urgency: near sell-out or closing shows scarcity messaging.
function Scarcity({ c }) {
  if (c.status !== "open") return null;
  const remaining = Math.max(0, (c.maxTickets || 0) - (c.ticketsSold || 0));
  const soldPct = c.maxTickets ? (c.ticketsSold / c.maxTickets) * 100 : 0;
  if (c.maxTickets && (soldPct >= 80 || remaining <= 25)) {
    return <div className="pub-scarcity">🔥 Selling fast — only {remaining} of {c.maxTickets} left</div>;
  }
  return null;
}

function ShareButton({ c }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    const url = window.location.origin + "/raffles/" + c.id;
    const data = { title: c.title + " — KantoForge Competition", text: "Win " + c.title + " with KantoForge!", url };
    if (navigator.share) {
      try { await navigator.share(data); return; } catch (e) { /* cancelled */ }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch (e) { /* ignore */ }
  };
  return <button className="pub-btn ghost pub-share" onClick={share}>{copied ? "✓ Link copied" : "↗ Share"}</button>;
}

function WinnersList({ draw }) {
  const winners = draw.winners && draw.winners.length ? draw.winners : [{ place: 0, winningTicket: draw.winningTicket, winnerName: draw.winnerName }];
  const place = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
  return (
    <div className="pub-winner-banner">
      {winners.map((w) => (
        <div key={w.place} className="pub-winner-line">
          🏆 <b>{place[w.place]}: {w.winnerName}</b> — ticket #{w.winningTicket}{w.prize ? <span className="pub-muted"> · {w.prize}</span> : null}
        </div>
      ))}
    </div>
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
        {!drawn && <Scarcity c={c} />}
        {drawn && c.draw && (
          <div className="pub-winner-chip">
            🏆 {c.draw.winnerName} · #{c.draw.winningTicket}
            {c.draw.winners && c.draw.winners.length > 1 ? " +" + (c.draw.winners.length - 1) + " more" : ""}
          </div>
        )}
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
    const winners = c.draw.winners && c.draw.winners.length ? c.draw.winners : [{ place: 0, winningTicket: c.draw.winningTicket }];
    const r = await verifyWinners({
      serverSeed: c.draw.revealedSeed,
      serverSeedHash: c.serverSeedHash,
      publicEntropy: c.draw.publicEntropy,
      ticketsTotal: c.draw.ticketsTotal,
      winners,
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
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className={"pub-status " + c.status}>{drawn ? "Winner drawn" : open ? "Live" : "Closed"}</span>
            <ShareButton c={c} />
          </div>
          <h1>{c.title}</h1>
          {c.prize && <p className="pub-prize">{c.prize}</p>}
          {c.prizeTiers && c.prizeTiers.length > 0 && (
            <p className="pub-prize pub-muted">Plus runner-up prizes: {c.prizeTiers.join(" · ")}</p>
          )}
          {c.cashAlternative && <p className="pub-muted" style={{ marginTop: -8 }}>💷 Cash alternative available: {c.cashAlternative}</p>}

          {!drawn && <Progress sold={c.ticketsSold} max={c.maxTickets} />}
          {!drawn && <Scarcity c={c} />}
          {open && c.closesAt && <div className="pub-count-wrap"><span className="pub-muted">Entries close in</span><Countdown closesAt={c.closesAt} /></div>}
          {open && c.drawDate && <div className="pub-muted small" style={{ marginTop: 4 }}>Winner drawn {shortDate(c.drawDate)}</div>}

          {drawn && c.draw && <WinnersList draw={c.draw} />}

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

function HowItWorks({ navigate }) {
  return (
    <div className="pub-wrap pub-detail pub-how">
      <button className="pub-back" onClick={() => navigate("/raffles")}>← All competitions</button>
      <h1>How our draws work</h1>
      <p className="pub-lead">Every KantoForge competition is drawn with a <b>provably-fair</b> method. You don't have to take our word for it — you can check the result yourself.</p>

      <ol className="pub-steps">
        <li>
          <h3>1. We commit before entries open</h3>
          <p>When a competition is created we generate a secret random number (the “seed”) and publish its <b>SHA-256 fingerprint</b> on the competition page. A fingerprint can't be reversed, so we can't change the seed later without the fingerprint changing — the outcome is locked in advance.</p>
        </li>
        <li>
          <h3>2. Tickets are numbered in order</h3>
          <p>Every entry is given sequential ticket numbers as it comes in, so the full list of tickets is fixed and public before the draw.</p>
        </li>
        <li>
          <h3>3. We fold in a value we can't control</h3>
          <p>At draw time we combine the secret seed with a public future value — for example a named National Lottery result — that nobody can predict or influence. This proves the seed wasn't hand-picked to make a particular ticket win.</p>
        </li>
        <li>
          <h3>4. The winning number is calculated, and the seed revealed</h3>
          <p>The winning ticket is derived from those two values by a fixed formula, then the secret seed is published. Anyone can confirm the revealed seed matches the fingerprint from step 1 and recompute the exact winning number.</p>
        </li>
      </ol>

      <div className="pub-fair" style={{ marginTop: 8 }}>
        <h3>🔒 Verify any draw yourself</h3>
        <p className="pub-muted">On every finished competition there's a <b>“Verify this draw in your browser”</b> button that runs the check live, right on your device — no trust required.</p>
      </div>

      <p className="pub-muted" style={{ marginTop: 22 }}>Prize competitions require a question of skill and offer a free postal entry route. Open to UK residents aged 18+. Please play responsibly.</p>
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

  const isHow = path === "/raffles/how-it-works";
  const detailId = useMemo(() => {
    if (path === "/raffles/how-it-works") return null;
    const m = path.match(/^\/raffles\/(.+)$/);
    return m ? decodeURIComponent(m[1]) : null;
  }, [path]);

  const detail = detailId && comps ? comps.find((c) => c.id === detailId) : null;

  return (
    <div className="pub-root">
      <Header navigate={navigate} />
      <main>
        {isHow && <HowItWorks navigate={navigate} />}
        {!isHow && comps === null && !error && <div className="pub-wrap pub-empty">Loading competitions…</div>}
        {!isHow && error && <div className="pub-wrap pub-empty">{error}</div>}
        {!isHow && comps && !error && detailId && !detail && (
          <div className="pub-wrap pub-empty">That competition isn't available. <a href="/raffles" onClick={(e) => { e.preventDefault(); navigate("/raffles"); }}>See all competitions →</a></div>
        )}
        {!isHow && comps && !error && detail && <DetailView c={detail} navigate={navigate} />}
        {!isHow && comps && !error && !detailId && <ListView comps={comps} navigate={navigate} />}
      </main>
      <Footer />
    </div>
  );
}
