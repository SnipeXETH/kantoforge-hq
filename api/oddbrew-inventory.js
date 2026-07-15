// Vercel serverless function: pull live stock levels for the OddBrew Shopify
// store into Supabase (oddbrew_inventory), keyed the same way the portal keys
// sold line items (SKU first, else variant name) so the Analysis tab can line
// up "sold" against "in stock". Same credentials/checkpoint plumbing as
// sync-oddbrew — a separate store from KantoForge.
//
// Reuses ODDBREW_SHOPIFY_* env / oddbrew_secrets token from the OAuth connect.

const { createClient } = require("@supabase/supabase-js");

const API_VERSION = "2024-10";

const squash = (s) => String(s == null ? "" : s).toLowerCase().replace(/\s+/g, "");
function variantKey(sku, name) {
  const s = squash(sku);
  if (s) return "sku:" + s;
  return "name:" + squash(name);
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
    return { products: body.products || [], nextUrl: next ? next[1] : null };
  }
  throw new Error("Shopify API kept rate-limiting (429) — try again in a minute.");
}

async function resolveConn(supaAdmin) {
  const { data } = await supaAdmin.from("oddbrew_secrets").select("data").eq("id", 1).maybeSingle();
  const d = (data && data.data) || {};
  const token = (d.adminToken || process.env.ODDBREW_SHOPIFY_ADMIN_TOKEN || "").trim();
  const shop = (d.shopDomain || process.env.ODDBREW_SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
  return { token, shop };
}

// One row per Shopify variant: total on-hand across locations comes straight
// from the REST variant's inventory_quantity, which is exactly "how many I
// have" — the number the user wants to track against sales.
function mapVariant(product, v) {
  const vt = v.title && v.title !== "Default Title" ? v.title : "";
  const name = product.title + (vt ? " — " + vt : "");
  return {
    key: variantKey(v.sku, name),
    name,
    sku: v.sku || "",
    shopifyAvailable: typeof v.inventory_quantity === "number" ? v.inventory_quantity : null,
    shopifyVariantId: String(v.id),
    shopifyProductId: String(product.id),
    inventoryItemId: v.inventory_item_id != null ? String(v.inventory_item_id) : null,
    lastSyncedAt: new Date().toISOString(),
  };
}

async function runInventorySync(supaAdmin) {
  const { token, shop } = await resolveConn(supaAdmin);
  if (!token) {
    const err = new Error("OddBrew isn't connected to Shopify yet — open OddBrew in the portal and click Connect.");
    err.notConnected = true;
    throw err;
  }
  if (!shop) throw new Error("OddBrew store domain unknown — reconnect Shopify from the portal.");

  // Existing rows carry the user's manual counts (onHand/incoming/reorderPoint);
  // a sync only refreshes the Shopify-derived fields, never clobbers those.
  const { data: existingRows } = await supaAdmin.from("oddbrew_inventory").select("id,data");
  const existing = new Map((existingRows || []).map((r) => [r.id, r.data || {}]));

  let url = `https://${shop}/admin/api/${API_VERSION}/products.json?limit=250&fields=id,title,variants`;
  const upserts = [];
  const seen = new Set();
  let variants = 0;

  while (url) {
    const page = await fetchPage(url, token);
    for (const p of page.products) {
      for (const v of p.variants || []) {
        const mapped = mapVariant(p, v);
        if (seen.has(mapped.key)) continue; // first variant wins a shared key
        seen.add(mapped.key);
        variants += 1;
        const prev = existing.get(mapped.key) || {};
        upserts.push({
          id: mapped.key,
          data: {
            ...prev,          // keep manual onHand / incoming / reorderPoint
            ...mapped,        // refresh Shopify-derived fields + name/sku
          },
          updated_at: new Date().toISOString(),
        });
      }
    }
    url = page.nextUrl;
  }

  for (let i = 0; i < upserts.length; i += 400) {
    const { error } = await supaAdmin.from("oddbrew_inventory").upsert(upserts.slice(i, i + 400));
    if (error) throw new Error("Supabase upsert: " + error.message);
  }
  return { variants, synced: upserts.length };
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
    const url = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
    if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return res.status(500).json({ ok: false, error: "OddBrew inventory sync isn't configured yet." });
    }
    const supaAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    if (!(await isAuthorized(req, supaAdmin))) {
      return res.status(401).json({ ok: false, error: "Not authorised — sign in and try again." });
    }
    const result = await runInventorySync(supaAdmin);
    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const code = e.notConnected ? 409 : 500;
    return res.status(code).json({ ok: false, error: e.message || String(e), notConnected: !!e.notConnected });
  }
};

module.exports.runInventorySync = runInventorySync;
