// Serves the SPA shell for /raffles and /raffles/:id with per-competition Open
// Graph / Twitter meta injected, so links shared to Discord/WhatsApp/Facebook
// show the prize image and title. The React app still boots and takes over.
// Secrets are never exposed — only public title/prize/price text and an image URL.

const { createClient } = require("@supabase/supabase-js");

function esc(s) {
  return String(s == null ? "" : s).replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}

module.exports = async (req, res) => {
  const host = req.headers["x-forwarded-host"] || req.headers.host || "";
  const proto = req.headers["x-forwarded-proto"] || "https";
  const origin = proto + "://" + host;

  let title = "KantoForge Competitions";
  let desc = "Win graded slabs & sealed grails — skill-based prize competitions with provably-fair draws.";
  let image = origin + "/brand/logo-light@2x.png";
  const path = (req.url || "/raffles").split("?")[0];
  const url = origin + path;

  try {
    const id = req.query && req.query.id;
    if (id && id !== "how-it-works") {
      const supaUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (supaUrl && key) {
        const supa = createClient(supaUrl, key, { auth: { persistSession: false } });
        const { data } = await supa.from("competitions").select("data").eq("id", id).maybeSingle();
        const c = data && data.data;
        if (c && c.isPublic) {
          title = c.title + " — KantoForge Competition";
          const bits = [];
          if (c.prize) bits.push(String(c.prize).slice(0, 120));
          bits.push("£" + (c.ticketPrice || 0) + " per entry");
          if (c.status === "drawn" && c.draw) bits.push("Winner drawn — verify it yourself");
          desc = bits.join(" · ");
          if (c.prizeImage) image = origin + "/api/raffle-image?id=" + encodeURIComponent(id);
        }
      }
    } else if (id === "how-it-works") {
      title = "How our draws work — KantoForge";
      desc = "Every KantoForge competition is drawn with a published, independently-verifiable provably-fair method.";
    }
  } catch (e) {
    /* fall back to generic meta */
  }

  let html;
  try {
    const r = await fetch(origin + "/index.html");
    html = await r.text();
  } catch (e) {
    html = '<!doctype html><html><head></head><body><div id="root"></div></body></html>';
  }

  const meta =
    `\n<meta property="og:type" content="website">` +
    `\n<meta property="og:site_name" content="KantoForge">` +
    `\n<meta property="og:title" content="${esc(title)}">` +
    `\n<meta property="og:description" content="${esc(desc)}">` +
    `\n<meta property="og:image" content="${esc(image)}">` +
    `\n<meta property="og:url" content="${esc(url)}">` +
    `\n<meta name="twitter:card" content="summary_large_image">` +
    `\n<meta name="twitter:title" content="${esc(title)}">` +
    `\n<meta name="twitter:description" content="${esc(desc)}">` +
    `\n<meta name="twitter:image" content="${esc(image)}">\n`;

  html = html
    .replace(/<title>.*?<\/title>/i, `<title>${esc(title)}</title>`)
    .replace("</head>", meta + "</head>");

  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "public, max-age=30");
  return res.status(200).send(html);
};
