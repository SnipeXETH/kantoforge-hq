// Vercel serverless function: pull orders from the Shopify Admin API into
// Supabase. Trigger it from the app ("Sync Shopify now") or via the nightly
// Vercel cron configured in vercel.json.
//
// Large stores can't be fetched inside one function invocation (60s limit),
// so the sync is RESUMABLE: it upserts page by page, saves a cursor in
// app_settings, and returns { done: false } when it ran out of time budget.
// The app keeps calling until { done: true }. First run backfills history
// oldest-first; after that it's a quick incremental sync by updated_at.
//
// Required env vars (Vercel → Settings → Environment Variables):
//   SHOPIFY_STORE_DOMAIN        e.g. kantoforge.myshopify.com
//   SHOPIFY_ADMIN_TOKEN         Admin API access token from your custom app (shpat_…)
//   SUPABASE_SERVICE_ROLE_KEY   Supabase → Settings → API → service_role (secret!)
//   REACT_APP_SUPABASE_URL      already set for the app itself
//   CRON_SECRET                 any random string; lets the nightly cron authenticate

const { createClient } = require("@supabase/supabase-js");

const API_VERSION = "2024-10";
const TIME_BUDGET_MS = 40 * 1000; // stop fetching well before Vercel's 60s limit
const OVERLAP_MS = 10 * 60 * 1000; // incremental syncs re-fetch a 10-minute overlap

function missingConfig() {
  const need = {
    SHOPIFY_STORE_DOMAIN: process.env.SHOPIFY_STORE_DOMAIN,
    SHOPIFY_ADMIN_TOKEN: process.env.SHOPIFY_ADMIN_TOKEN,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    REACT_APP_SUPABASE_URL: process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
  };
  return Object.keys(need).filter((k) => !need[k]);
}

function shopDomain() {
  return (process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(url) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const resp = await fetch(url, { headers: { "X-Shopify-Access-Token": (process.env.SHOPIFY_ADMIN_TOKEN || "").trim() } });
    if (resp.status === 429) {
      await sleep(1500);
      continue;
    }
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

// Map a Shopify Admin API order to the app's normalised order shape —
// the same shape the CSV importer produces, so everything downstream
// (fees, profit, analytics, coverage grid) just works.
function mapOrder(o) {
  const items = (o.line_items || []).map((li) => ({
    name: li.title + (li.variant_title ? " — " + li.variant_title : ""),
    sku: li.sku || "",
    qty: li.quantity || 1,
    price: parseFloat(li.price) || 0,
  }));
  const refunded = (o.refunds || []).reduce(
    (sum, r) =>
      sum +
      (r.transactions || []).reduce(
        (s, t) => s + (t.kind === "refund" && t.status === "success" ? parseFloat(t.amount) || 0 : 0),
        0
      ),
    0
  );
  const shipping = (o.shipping_lines || []).reduce((s, l) => s + (parseFloat(l.price) || 0), 0);
  const buyer =
    (o.customer && `${o.customer.first_name || ""} ${o.customer.last_name || ""}`.trim()) ||
    (o.billing_address && o.billing_address.name) ||
    "";
  // Orders pushed into Shopify by the Etsy integration are tagged "Etsy"
  // (and usually carry an etsy-ish source_name) — they belong to the Etsy
  // channel and its fee model.
  const isEtsy = /(^|,)\s*etsy\s*(,|$)/i.test(o.tags || "") || /etsy/i.test(o.source_name || "");
  return {
    id: "shopify:" + o.name,
    platform: isEtsy ? "etsy" : "shopify",
    channelVia: "shopify",
    orderId: o.name,
    date: o.created_at ? new Date(o.created_at).toISOString() : null,
    currency: o.currency || "GBP",
    itemsTotal: parseFloat(o.subtotal_price) || 0, // discount-inclusive, like the CSV export
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
      platform: order.platform,
      order_date: order.date,
      data: order,
    }));
    const { error } = await supaAdmin.from("orders").upsert(chunk);
    if (error) throw new Error("Supabase upsert: " + error.message);
  }
}

// One resumable sync step. Returns { fetched, done, mode }.
async function runSync(supaAdmin) {
  const { data: row, error: settingsErr } = await supaAdmin.from("app_settings").select("data").eq("id", 1).maybeSingle();
  if (settingsErr) throw new Error("Supabase: " + settingsErr.message);
  const settings = (row && row.data) || {};
  const prev = settings.shopifySync || {};

  const backfillDone = !!prev.backfillDone;
  const mode = backfillDone ? "incremental" : "backfill";

  let url = `https://${shopDomain()}/admin/api/${API_VERSION}/orders.json?status=any&limit=250`;
  if (mode === "backfill") {
    url += "&order=" + encodeURIComponent("created_at asc");
    if (prev.backfillCursor) url += `&created_at_min=${encodeURIComponent(prev.backfillCursor)}`;
  } else {
    const since = new Date(new Date(prev.lastSyncAt).getTime() - OVERLAP_MS).toISOString();
    url += `&updated_at_min=${encodeURIComponent(since)}`;
  }

  const started = Date.now();
  let fetched = 0;
  let cursor = prev.backfillCursor || null;

  while (url && Date.now() - started < TIME_BUDGET_MS) {
    const page = await fetchPage(url);
    const usable = page.orders.filter((o) => !o.test);
    await upsertOrders(supaAdmin, usable.map(mapOrder));
    fetched += usable.length;
    if (page.orders.length) {
      const last = page.orders[page.orders.length - 1];
      if (last.created_at) cursor = last.created_at;
    }
    url = page.nextUrl;
  }

  const done = !url;
  const total = (prev.backfillFetched || 0) + (mode === "backfill" ? fetched : 0);
  const shopifySync = done
    ? {
        backfillDone: true,
        backfillFetched: mode === "backfill" ? total : prev.backfillFetched,
        lastSyncAt: new Date().toISOString(),
        lastFetched: fetched,
        mode,
      }
    : { ...prev, backfillDone: false, backfillCursor: cursor, backfillFetched: total, mode };

  await supaAdmin.from("app_settings").upsert({ id: 1, data: { ...settings, shopifySync } });
  return { fetched, done, mode };
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
      return res.status(500).json({ ok: false, error: "Shopify sync isn't configured yet.", missing });
    }
    const supaAdmin = createClient(
      process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );

    if (!(await isAuthorized(req, supaAdmin))) {
      return res.status(401).json({ ok: false, error: "Not authorised — sign in and try again." });
    }

    const result = await runSync(supaAdmin);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};

module.exports.mapOrder = mapOrder;
module.exports.runSync = runSync;
module.exports.fetchPage = fetchPage;
