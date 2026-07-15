// Vercel serverless function: pull orders from the OddBrew Shopify store into
// Supabase (oddbrew_orders). A separate store from KantoForge — its own
// credentials and its own resumable checkpoint (in oddbrew_config), so the two
// syncs never touch each other's data.
//
// Required env vars (Vercel → Settings → Environment Variables):
//   ODDBREW_SHOPIFY_STORE_DOMAIN   e.g. oddbrew.myshopify.com
//   ODDBREW_SHOPIFY_ADMIN_TOKEN    Admin API access token from the OddBrew custom app (shpat_…)
//   SUPABASE_SERVICE_ROLE_KEY      (shared with KantoForge)
//   REACT_APP_SUPABASE_URL         (already set)
//   CRON_SECRET                    (shared) lets the nightly cron authenticate

const { createClient } = require("@supabase/supabase-js");

const API_VERSION = "2024-10";
const TIME_BUDGET_MS = 40 * 1000;
const OVERLAP_MS = 10 * 60 * 1000;

function missingConfig() {
  const need = {
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    REACT_APP_SUPABASE_URL: process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
  };
  return Object.keys(need).filter((k) => !need[k]);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url, token) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const resp = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    if (resp.status === 429) { await sleep(1500); continue; }
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 300);
      throw new Error(`Shopify API responded ${resp.status}: ${text}`);
    }
    const body = await resp.json();
    const link = resp.headers.get("link") || "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    return { orders: body.orders || [], nextUrl: next ? next[1] : null };
  }
  throw new Error("Shopify API kept rate-limiting (429) — try again in a minute.");
}

// Map a Shopify order to the app's normalised order shape. OddBrew is
// Shopify-only, so no Etsy branch, and the id is prefixed "oddbrew:" so it can
// never collide with a KantoForge order.
function mapOrder(o) {
  const items = (o.line_items || []).map((li) => ({
    name: li.title + (li.variant_title ? " — " + li.variant_title : ""),
    sku: li.sku || "",
    qty: li.quantity || 1,
    price: parseFloat(li.price) || 0,
  }));
  const refunded = (o.refunds || []).reduce(
    (sum, r) => sum + (r.transactions || []).reduce(
      (s, t) => s + (t.kind === "refund" && t.status === "success" ? parseFloat(t.amount) || 0 : 0), 0), 0);
  const shipping = (o.shipping_lines || []).reduce((s, l) => s + (parseFloat(l.price) || 0), 0);
  const buyer =
    (o.customer && `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim()) ||
    (o.billing_address && o.billing_address.name) || "";
  const country =
    (o.shipping_address && o.shipping_address.country_code) ||
    (o.billing_address && o.billing_address.country_code) || "";
  return {
    id: "oddbrew:" + o.name,
    platform: "shopify",
    channelVia: "shopify",
    orderId: o.name,
    country,
    date: o.created_at ? new Date(o.created_at).toISOString() : null,
    currency: o.currency || "GBP",
    itemsTotal: parseFloat(o.subtotal_price) || 0,
    shipping,
    discount: 0,
    rawDiscount: parseFloat(o.total_discounts) || 0,
    tax: parseFloat(o.total_tax) || 0,
    total: parseFloat(o.total_price) || 0,
    refunded,
    feesActual: null,
    buyer,
    email: o.email || o.contact_email || (o.customer && o.customer.email) || "",
    status: o.financial_status || "paid",
    tags: o.tags || "",
    items,
    source: "api",
  };
}

async function upsertOrders(supaAdmin, orders) {
  for (let i = 0; i < orders.length; i += 400) {
    const chunk = orders.slice(i, i + 400).map((order) => ({
      id: order.id,
      order_date: order.date,
      data: order,
    }));
    const { error } = await supaAdmin.from("oddbrew_orders").upsert(chunk);
    if (error) throw new Error("Supabase upsert: " + error.message);
  }
}

async function shopifyOrderCount(token, shop) {
  try {
    const r = await fetch(`https://${shop}/admin/api/${API_VERSION}/orders/count.json?status=any`, {
      headers: { "X-Shopify-Access-Token": token },
    });
    if (!r.ok) return null;
    const b = await r.json();
    return typeof b.count === "number" ? b.count : null;
  } catch (e) {
    return null;
  }
}

async function resolveConn(supaAdmin) {
  const { data } = await supaAdmin.from("oddbrew_secrets").select("data").eq("id", 1).maybeSingle();
  const d = (data && data.data) || {};
  const token = (d.adminToken || process.env.ODDBREW_SHOPIFY_ADMIN_TOKEN || "").trim();
  const shop = (d.shopDomain || process.env.ODDBREW_SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  return { token, shop };
}

async function runSync(supaAdmin, opts = {}) {
  const { token, shop } = await resolveConn(supaAdmin);
  if (!token) {
    const err = new Error("OddBrew isn't connected to Shopify yet — open OddBrew in the portal and click Connect.");
    err.notConnected = true;
    throw err;
  }
  if (!shop) throw new Error("OddBrew store domain unknown — reconnect Shopify from the portal.");
  const { data: row, error: cfgErr } = await supaAdmin.from("oddbrew_config").select("data").eq("id", 1).maybeSingle();
  if (cfgErr) throw new Error("Supabase: " + cfgErr.message);
  const config = (row && row.data) || {};
  const prevRaw = config.sync || {};
  const prev = opts.full || prevRaw.version !== 2 ? {} : prevRaw;

  const backfillDone = !!prev.backfillDone;
  const mode = backfillDone ? "incremental" : "backfill";

  const base = `https://${shop}/admin/api/${API_VERSION}/orders.json?status=any&limit=250`;
  let url;
  if (mode === "backfill") {
    url = base + (prev.backfillCursor ? `&created_at_max=${encodeURIComponent(prev.backfillCursor)}` : "");
  } else {
    const since = new Date(new Date(prev.lastSyncAt).getTime() - OVERLAP_MS).toISOString();
    url = base + `&updated_at_min=${encodeURIComponent(since)}`;
  }

  const started = Date.now();
  let fetched = 0;
  let cursor = prev.backfillCursor || null;
  let done = false;

  while (Date.now() - started < TIME_BUDGET_MS) {
    const page = await fetchPage(url, token);
    const usable = page.orders.filter((o) => !o.test);
    await upsertOrders(supaAdmin, usable.map(mapOrder));
    fetched += usable.length;
    for (const o of page.orders) {
      if (o.created_at && (!cursor || o.created_at < cursor)) cursor = o.created_at;
    }
    if (page.nextUrl) {
      url = page.nextUrl;
    } else if (mode === "backfill" && page.orders.length > 0 && cursor) {
      url = base + `&created_at_max=${encodeURIComponent(new Date(new Date(cursor).getTime() - 1000).toISOString())}`;
    } else {
      done = true;
      break;
    }
  }

  const total = (prev.backfillFetched || 0) + (mode === "backfill" ? fetched : 0);
  let sync;
  if (done) {
    sync = { version: 2, backfillDone: true, backfillFetched: mode === "backfill" ? total : prev.backfillFetched, lastSyncAt: new Date().toISOString(), lastFetched: fetched, mode };
  } else if (mode === "backfill") {
    sync = { version: 2, backfillDone: false, backfillCursor: cursor, backfillFetched: total, mode };
  } else {
    sync = { ...prev, version: 2, mode };
  }

  await supaAdmin.from("oddbrew_config").upsert({ id: 1, data: { ...config, sync } });
  const shopifyTotal = await shopifyOrderCount(token, shop);
  return { fetched, done, mode, shopifyTotal, oldestSeen: cursor };
}

async function isAuthorized(req, supaAdmin) {
  const header = req.headers.authorization || "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) return true;
  const { data, error } = await supaAdmin.auth.getUser(token);
  return !error && !!(data && data.user);
}

module.exports = async (req, res) => {
  try {
    const missing = missingConfig();
    if (missing.length) {
      return res.status(500).json({ ok: false, error: "OddBrew Shopify sync isn't configured yet.", missing });
    }
    const supaAdmin = createClient(
      process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
    if (!(await isAuthorized(req, supaAdmin))) {
      return res.status(401).json({ ok: false, error: "Not authorised — sign in and try again." });
    }
    const full = /[?&]full=1/.test(req.url || "");
    const result = await runSync(supaAdmin, { full });
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};

module.exports.mapOrder = mapOrder;
module.exports.runSync = runSync;
