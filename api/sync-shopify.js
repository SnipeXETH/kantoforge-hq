// Vercel serverless function: pull orders from the Shopify Admin API into
// Supabase. Trigger it from the app ("Sync Shopify now") or via the nightly
// Vercel cron configured in vercel.json.
//
// Required env vars (Vercel → Settings → Environment Variables):
//   SHOPIFY_STORE_DOMAIN        e.g. kantoforge.myshopify.com
//   SHOPIFY_ADMIN_TOKEN         Admin API access token from your custom app (shpat_…)
//   SUPABASE_SERVICE_ROLE_KEY   Supabase → Settings → API → service_role (secret!)
//   REACT_APP_SUPABASE_URL      already set for the app itself
//   CRON_SECRET                 any random string; lets the nightly cron authenticate

const { createClient } = require("@supabase/supabase-js");

const API_VERSION = "2024-10";
const MAX_PAGES = 40; // 40 × 250 = 10k orders per run; reruns continue via lastSyncAt
const OVERLAP_MS = 10 * 60 * 1000; // re-fetch a 10-minute overlap so nothing slips between runs

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
  return (process.env.SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchShopifyOrders(sinceIso) {
  let url = `https://${shopDomain()}/admin/api/${API_VERSION}/orders.json?status=any&limit=250`;
  if (sinceIso) url += `&updated_at_min=${encodeURIComponent(sinceIso)}`;
  const all = [];
  let retries = 0;
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const resp = await fetch(url, { headers: { "X-Shopify-Access-Token": process.env.SHOPIFY_ADMIN_TOKEN } });
    if (resp.status === 429 && retries < 5) {
      retries++;
      page--;
      await sleep(1500);
      continue;
    }
    if (!resp.ok) {
      const text = (await resp.text()).slice(0, 300);
      throw new Error(`Shopify API responded ${resp.status}: ${text}`);
    }
    const body = await resp.json();
    all.push(...(body.orders || []));
    const link = resp.headers.get("link") || "";
    const next = link.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : null;
  }
  return all;
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
  return {
    id: "shopify:" + o.name,
    platform: "shopify",
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
    status: o.financial_status || "paid",
    items,
    source: "api",
  };
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

    // Incremental sync from the last run (with overlap); full history first time.
    const { data: row, error: settingsErr } = await supaAdmin.from("app_settings").select("data").eq("id", 1).maybeSingle();
    if (settingsErr) throw new Error("Supabase: " + settingsErr.message);
    const settings = (row && row.data) || {};
    const lastSyncAt = settings.shopifySync && settings.shopifySync.lastSyncAt;
    const since = lastSyncAt ? new Date(new Date(lastSyncAt).getTime() - OVERLAP_MS).toISOString() : null;

    const raw = await fetchShopifyOrders(since);
    const orders = raw.filter((o) => !o.test).map(mapOrder);

    for (let i = 0; i < orders.length; i += 400) {
      const chunk = orders.slice(i, i + 400).map((order) => ({
        id: order.id,
        platform: "shopify",
        order_date: order.date,
        data: order,
      }));
      const { error } = await supaAdmin.from("orders").upsert(chunk);
      if (error) throw new Error("Supabase upsert: " + error.message);
    }

    const shopifySync = {
      lastSyncAt: new Date().toISOString(),
      lastFetched: orders.length,
      mode: since ? "incremental" : "full",
    };
    await supaAdmin.from("app_settings").upsert({ id: 1, data: { ...settings, shopifySync } });

    return res.status(200).json({ ok: true, fetched: orders.length, mode: shopifySync.mode, lastSyncAt: shopifySync.lastSyncAt });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || String(e) });
  }
};

module.exports.mapOrder = mapOrder;
module.exports.fetchShopifyOrders = fetchShopifyOrders;
