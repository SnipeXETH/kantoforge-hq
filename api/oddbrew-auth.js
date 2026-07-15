// OddBrew Shopify OAuth connect flow (one endpoint = start + callback).
//
// Shopify's Dev Dashboard apps use OAuth (Client ID + secret) rather than a
// static Admin API token. An admin visits /api/oddbrew-auth once, approves the
// install, and Shopify redirects back here with a code we exchange for a
// permanent offline access token — stored server-side in oddbrew_secrets
// (never exposed to the browser). The sync then uses that token.
//
// Env vars (Vercel):
//   ODDBREW_SHOPIFY_STORE_DOMAIN    oddbrew.myshopify.com
//   ODDBREW_SHOPIFY_CLIENT_ID       Dev Dashboard app Client ID
//   ODDBREW_SHOPIFY_CLIENT_SECRET   Dev Dashboard app Secret (shpss_…)
//   SUPABASE_SERVICE_ROLE_KEY, REACT_APP_SUPABASE_URL (already set)
//
// In the Dev Dashboard app, add this exact URL as an allowed redirect:
//   https://<your-portal-domain>/api/oddbrew-auth

const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");

const SCOPES = "read_orders,read_products";

function shopDomain() {
  return (process.env.ODDBREW_SHOPIFY_STORE_DOMAIN || "").replace(/^https?:\/\//, "").replace(/\/.*$/, "").trim();
}

function verifyHmac(params, secret) {
  const hmac = params.get("hmac");
  if (!hmac) return false;
  const msg = [...params.entries()]
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const digest = crypto.createHmac("sha256", secret).update(msg).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmac));
  } catch (e) {
    return false;
  }
}

function page(title, body) {
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font-family:system-ui,sans-serif;background:#0f1115;color:#e8eaed;display:grid;place-items:center;min-height:100vh;margin:0">
<div style="text-align:center;max-width:420px;padding:24px">${body}</div>`;
}

module.exports = async (req, res) => {
  try {
    const clientId = process.env.ODDBREW_SHOPIFY_CLIENT_ID;
    const clientSecret = process.env.ODDBREW_SHOPIFY_CLIENT_SECRET;
    const shop = shopDomain();
    if (!clientId || !clientSecret || !shop) {
      const missing = [];
      if (!process.env.ODDBREW_SHOPIFY_STORE_DOMAIN) missing.push("ODDBREW_SHOPIFY_STORE_DOMAIN");
      if (!clientId) missing.push("ODDBREW_SHOPIFY_CLIENT_ID");
      if (!clientSecret) missing.push("ODDBREW_SHOPIFY_CLIENT_SECRET");
      res.setHeader("Content-Type", "text/html");
      return res.status(500).send(page("OddBrew not configured",
        "<h2>OddBrew OAuth isn't configured</h2>" +
        "<p>These variable(s) aren't reaching the server:</p>" +
        "<p style='font-family:monospace;color:#ff8a8a'>" + missing.join("<br>") + "</p>" +
        "<p style='color:#9aa'>Set them in Vercel for the <b>Production</b> environment, then trigger a <b>new deployment</b> (env-var changes only apply to deployments made after they're added). Check for stray spaces and exact names.</p>"));
    }

    const url = new URL(req.url, `https://${req.headers.host}`);
    const params = url.searchParams;
    const redirectUri = `https://${req.headers.host}/api/oddbrew-auth`;

    // --- Callback leg: Shopify sent us back with a code ---
    if (params.get("code")) {
      if (!verifyHmac(params, clientSecret)) {
        res.setHeader("Content-Type", "text/html");
        return res.status(400).send(page("Failed", "<h2>Couldn't verify Shopify's response</h2><p>The security check (HMAC) failed. Please try connecting again.</p>"));
      }
      const shopParam = params.get("shop");
      if (shopParam && shopParam !== shop) {
        res.setHeader("Content-Type", "text/html");
        return res.status(400).send(page("Failed", "<h2>Unexpected store</h2><p>This didn't come from the OddBrew store.</p>"));
      }
      const tokenResp = await fetch(`https://${shop}/admin/oauth/access_token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code: params.get("code") }),
      });
      const tokenBody = await tokenResp.json().catch(() => ({}));
      if (!tokenBody.access_token) {
        res.setHeader("Content-Type", "text/html");
        return res.status(500).send(page("Failed", "<h2>Token exchange failed</h2><p>" + String(tokenBody.error_description || tokenBody.error || "No token returned").slice(0, 200) + "</p>"));
      }
      const supa = createClient(process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
      await supa.from("oddbrew_secrets").upsert({ id: 1, data: { adminToken: tokenBody.access_token, scope: tokenBody.scope, connectedAt: new Date().toISOString() }, updated_at: new Date().toISOString() });
      // A non-secret "connected" flag the app can read to show status.
      const { data: cfgRow } = await supa.from("oddbrew_config").select("data").eq("id", 1).maybeSingle();
      const config = (cfgRow && cfgRow.data) || {};
      await supa.from("oddbrew_config").upsert({ id: 1, data: { ...config, shopifyConnected: true, shopifyConnectedAt: new Date().toISOString() }, updated_at: new Date().toISOString() });

      res.setHeader("Content-Type", "text/html");
      return res.status(200).send(page("Connected", "<h2>✓ OddBrew connected to Shopify</h2><p>You can close this tab and run a sync from the portal (OddBrew → Sync OddBrew now).</p>"));
    }

    // --- Start leg: send the admin to Shopify to approve ---
    const state = crypto.randomBytes(12).toString("hex");
    const authUrl = `https://${shop}/admin/oauth/authorize?client_id=${encodeURIComponent(clientId)}&scope=${encodeURIComponent(SCOPES)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;
    res.writeHead(302, { Location: authUrl });
    return res.end();
  } catch (e) {
    res.setHeader("Content-Type", "text/html");
    return res.status(500).send(page("Error", "<h2>OAuth error</h2><p>" + String(e.message || e).slice(0, 200) + "</p>"));
  }
};
