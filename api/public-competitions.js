// Public, unauthenticated read API for the customer-facing raffle pages.
//
// Critical: the competitions table holds the secret draw seed (serverSeed) and
// the correct skill answer. Those must NEVER reach the public. This endpoint
// runs server-side with the service role and returns only sanitised fields —
// the pre-committed hash is public by design, the seed is only ever exposed via
// the post-draw `revealedSeed`, and the correct-answer index is stripped.

const { createClient } = require("@supabase/supabase-js");

function sanitize(c, ticketsSold) {
  const pub = {
    id: c.id,
    title: c.title,
    prize: c.prize,
    prizeImage: c.prizeImage || null,
    ticketPrice: c.ticketPrice,
    maxTickets: c.maxTickets,
    closesAt: c.closesAt || null,
    question: c.question,
    answers: c.answers, // options only — which one is correct is NOT exposed
    freeEntryInfo: c.freeEntryInfo || "",
    status: c.status,
    serverSeedHash: c.serverSeedHash, // the commitment — meant to be public
    ticketsSold,
  };
  if (c.status === "drawn" && c.draw) {
    pub.draw = {
      drawnAt: c.draw.drawnAt,
      publicEntropy: c.draw.publicEntropy || "",
      ticketsTotal: c.draw.ticketsTotal,
      finalHash: c.draw.finalHash,
      winningTicket: c.draw.winningTicket,
      winnerName: c.draw.winnerName,
      revealedSeed: c.draw.revealedSeed, // safe post-draw: enables verification
    };
  }
  return pub;
}

module.exports = async (req, res) => {
  try {
    const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return res.status(200).json({ ok: false, configured: false, competitions: [] });

    const supa = createClient(url, key, { auth: { persistSession: false } });
    const { data: rows, error } = await supa.from("competitions").select("data");
    if (error) throw new Error(error.message);

    // Only competitions explicitly published to the public site, and never drafts.
    const list = (rows || []).map((r) => r.data).filter((c) => c && c.isPublic && c.status !== "draft");

    const ids = list.map((c) => c.id);
    const sold = {};
    if (ids.length) {
      const { data: entries } = await supa.from("raffle_entries").select("data").in("competition_id", ids);
      for (const e of entries || []) {
        const d = e.data;
        sold[d.competitionId] = (sold[d.competitionId] || 0) + Math.max(1, d.quantity || 1);
      }
    }

    const wantId = (req.query && req.query.id) || new URL(req.url, "http://x").searchParams.get("id");
    let out = list.map((c) => sanitize(c, sold[c.id] || 0));
    // stable ordering: live first, then closing soonest, drawn last
    const rank = { open: 0, closed: 1, drawn: 2 };
    out.sort((a, b) => (rank[a.status] - rank[b.status]) || (a.closesAt || "").localeCompare(b.closesAt || ""));
    if (wantId) out = out.filter((c) => c.id === wantId);

    res.setHeader("cache-control", "public, max-age=15");
    return res.status(200).json({ ok: true, configured: true, competitions: out });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e), competitions: [] });
  }
};
