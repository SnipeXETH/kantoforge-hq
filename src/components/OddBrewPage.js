import React, { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { uid, money, monthLabel } from "../lib/format";
import { GroupedBars, Legend } from "./charts";
import { mergeConfig, importOddbrewCsv, oddbrewTotals, oddbrewMonthly, buildInvoiceCostIndex, parseMetaSpendCsv, unmatchedBreakdown, activeOrders } from "../lib/oddbrew";
import OddBrewInvoices from "./OddBrewInvoices";

// The OMGO cost sheet, ready to seed (USD): [label, match, product, UK, US, EU].
const SHEET_SIZES = [
  ["350ml", "350ml", 3.09, 6.47, 10.74, 9.53],
  ["250ml", "250ml", 2.50, 5.44, 8.68, 8.06],
  ["200ml", "200ml", 2.50, 5.29, 8.38, 7.91],
  ["100ml", "100ml", 2.06, 4.71, 7.94, 7.18],
];

const MIGRATION = `create table if not exists public.oddbrew_orders (
  id text primary key, order_date timestamptz,
  data jsonb not null, updated_at timestamptz not null default now()
);
create table if not exists public.oddbrew_config (
  id int primary key, data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
insert into public.oddbrew_config (id, data) values (1, '{}'::jsonb) on conflict (id) do nothing;
alter table public.oddbrew_orders enable row level security;
alter table public.oddbrew_config enable row level security;
create policy "team full access" on public.oddbrew_orders for all to authenticated using (true) with check (true);
create policy "team full access" on public.oddbrew_config for all to authenticated using (true) with check (true);`;

const RANGES = [["all", "All time"], ["ytd", "This year"], ["12m", "12 months"], ["90d", "90 days"]];

function Stat({ label, value, sub, tone, accent }) {
  return (
    <div className="card" style={{ margin: 0, position: "relative", overflow: "hidden" }}>
      {accent && <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: accent }} />}
      <div className="muted" style={{ textTransform: "uppercase", letterSpacing: 0.6, fontSize: 10.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 27, fontWeight: 750, marginTop: 5, lineHeight: 1.1, color: tone || "var(--text)" }}>{value}</div>
      {sub != null && <div className="muted small" style={{ marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

export default function OddBrewPage({ user }) {
  const [ready, setReady] = useState(true);
  const [orders, setOrders] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [adspend, setAdspend] = useState([]);
  const [adReady, setAdReady] = useState(true);
  const [manualDate, setManualDate] = useState("");
  const [manualAmt, setManualAmt] = useState("");
  const adFileRef = useRef(null);
  const [cfg, setCfg] = useState(mergeConfig(null));
  const [range, setRange] = useState("all");
  const [tab, setTab] = useState("overview");
  const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState(null);
  const [showHelp, setShowHelp] = useState(false);
  const [connected, setConnected] = useState(false);
  const fileRef = useRef(null);

  const cur = cfg.currency || "GBP";

  const fetchOrders = async () => {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from("oddbrew_orders").select("data").order("order_date", { ascending: false }).range(from, from + 999);
      if (error) { setReady(false); return; }
      all.push(...data);
      if (data.length < 1000) break;
    }
    setReady(true);
    setOrders(all.map((r) => r.data));
  };

  const fetchConfig = async () => {
    const { data } = await supabase.from("oddbrew_config").select("data").eq("id", 1).maybeSingle();
    const raw = data && data.data ? data.data : null;
    setCfg(mergeConfig(raw));
    setConnected(!!(raw && raw.shopifyConnected));
  };

  const fetchInvoices = async () => {
    const { data, error } = await supabase.from("oddbrew_invoices").select("id,data");
    if (!error) setInvoices((data || []).map((r) => ({ id: r.id, ...r.data })));
  };
  const fetchAdspend = async () => {
    const { data, error } = await supabase.from("oddbrew_adspend").select("id,data");
    if (error) { setAdReady(false); return; }
    setAdReady(true);
    setAdspend((data || []).map((r) => ({ id: r.id, ...r.data })));
  };

  useEffect(() => { fetchOrders(); fetchConfig(); fetchInvoices(); fetchAdspend(); }, []);
  // Refresh invoices when returning to the overview (they drive actual costs).
  useEffect(() => { if (tab === "overview") fetchInvoices(); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps
  // Re-check connection when returning from the Shopify OAuth tab.
  useEffect(() => {
    const onFocus = () => fetchConfig();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const dateInRange = (dateStr) => {
    if (range === "all") return true;
    if (!dateStr) return false;
    const d = new Date(dateStr);
    const now = new Date();
    if (range === "ytd") return d.getFullYear() === now.getFullYear();
    const days = range === "90d" ? 90 : 365;
    return now - d <= days * 86400000;
  };
  const inRange = (o) => dateInRange(o.date);

  const active = activeOrders(orders || [], cfg);
  const costIndex = buildInvoiceCostIndex(invoices, active, cfg);
  const shown = active.filter(inRange);
  const totals = oddbrewTotals(shown, cfg, costIndex);
  const monthly = oddbrewMonthly(shown, cfg, costIndex);

  const adSpendRange = (adspend || []).filter((s) => dateInRange(s.date)).reduce((sum, s) => sum + (s.amount || 0), 0);
  const netAfterAds = totals.net - adSpendRange;
  const netMargin = totals.revenue > 0 ? (netAfterAds / totals.revenue) * 100 : null;
  const netTone = netAfterAds >= 0 ? "var(--good)" : "var(--bad)";
  const monthSpend = {};
  for (const s of adspend || []) { const mk = (s.date || "").slice(0, 7); if (mk) monthSpend[mk] = (monthSpend[mk] || 0) + (s.amount || 0); }
  const monthlyNet = monthly.map((m) => ({ ...m, profit: m.profit - (monthSpend[m.month] || 0) }));
  const unmatchedItems = unmatchedBreakdown(shown, cfg);

  const saveCfg = async (next) => {
    setErr(null);
    setCfg(next);
    const { error } = await supabase.from("oddbrew_config").upsert({ id: 1, data: next, updated_at: new Date().toISOString() });
    if (error) setErr(error.message);
    else { setMsg("Costs saved."); setTimeout(() => setMsg(null), 1800); }
  };
  const setField = (path, value) => {
    const next = { ...cfg };
    if (path[0] === "shopify") next.shopify = { ...next.shopify, [path[1]]: value };
    else next[path[0]] = value;
    setCfg(next);
  };
  const numField = (v) => (v === "" ? 0 : parseFloat(v) || 0);

  const rules = cfg.costRules || [];
  const setRules = (next) => setCfg({ ...cfg, costRules: next });
  const addRule = () => setRules([...rules, { id: uid(), label: "", match: "", productCost: 0, shipUK: 0, shipUS: 0, shipEU: 0 }]);
  const seedRules = () => setRules(SHEET_SIZES.map(([label, match, productCost, shipUK, shipUS, shipEU]) => ({ id: uid(), label, match, productCost, shipUK, shipUS, shipEU })));
  const addRuleFrom = (name) => {
    const mm = String(name).match(/(\d+)\s*ml/i);
    const match = mm ? mm[0].replace(/\s+/g, "") : String(name).slice(0, 40);
    const label = mm ? mm[1] + "ml" : String(name).slice(0, 20);
    setRules([...rules, { id: uid(), label, match, productCost: 0, shipUK: 0, shipUS: 0, shipEU: 0 }]);
  };
  const updateRule = (i, patch) => setRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeRule = (i) => setRules(rules.filter((_, idx) => idx !== i));
  const excludeItem = (name) => saveCfg({ ...cfg, excludeProducts: [...(cfg.excludeProducts || []), name] });

  const importFiles = async (files) => {
    setErr(null); setMsg(null); setBusy(true);
    try {
      let added = 0;
      for (const f of Array.from(files || [])) {
        const text = await f.text();
        const parsed = importOddbrewCsv(text);
        for (let i = 0; i < parsed.length; i += 400) {
          const chunk = parsed.slice(i, i + 400).map((o) => ({ id: o.id, order_date: o.date, data: o }));
          const { error } = await supabase.from("oddbrew_orders").upsert(chunk);
          if (error) throw new Error(error.message);
        }
        added += parsed.length;
      }
      setMsg(`Imported ${added} order${added === 1 ? "" : "s"} from CSV.`);
      await fetchOrders();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const importAdSpend = async (files) => {
    setErr(null); setMsg(null); setBusy(true);
    try {
      const summary = [];
      let note = null;
      for (const f of Array.from(files || [])) {
        const p = parseMetaSpendCsv(await f.text());
        if (p.currency && cur && p.currency !== cur) note = `Note: CSV is in ${p.currency}, store is ${cur} — amounts imported as-is.`;
        if (p.mode === "daily") {
          for (let i = 0; i < p.days.length; i += 200) {
            const chunk = p.days.slice(i, i + 200).map((d) => ({ id: d.date, data: { date: d.date, amount: d.amount, currency: p.currency, source: "meta-csv" }, updated_at: new Date().toISOString() }));
            const { error } = await supabase.from("oddbrew_adspend").upsert(chunk);
            if (error) throw new Error(error.message);
          }
          summary.push(`${p.days.length} days, ${money(p.total, cur)}`);
        } else {
          const fromM = (p.from || "").slice(0, 7);
          const toM = (p.to || "").slice(0, 7);
          if (!fromM || fromM !== toM) {
            throw new Error(`This export covers ${p.from || "?"} → ${p.to || "?"} (more than one month). Set the Meta date range to a single month and export again — then each month's spend is exact. (Or type monthly totals in below.)`);
          }
          const { error } = await supabase.from("oddbrew_adspend").upsert({ id: fromM, data: { date: fromM + "-01", month: fromM, amount: p.total, currency: p.currency, source: "meta-csv" }, updated_at: new Date().toISOString() });
          if (error) throw new Error(error.message);
          summary.push(`${fromM}: ${money(p.total, cur)}`);
        }
      }
      setMsg(`${note ? note + " " : ""}Imported ad spend — ${summary.join("; ")}.`);
      await fetchAdspend();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setBusy(false);
      if (adFileRef.current) adFileRef.current.value = "";
    }
  };
  const addManualSpend = async () => {
    setErr(null);
    if (!manualDate || manualAmt === "") return setErr("Pick a month and an amount.");
    const rec = { date: manualDate + "-01", month: manualDate, amount: parseFloat(manualAmt) || 0, currency: cur, source: "manual" };
    const { error } = await supabase.from("oddbrew_adspend").upsert({ id: manualDate, data: rec, updated_at: new Date().toISOString() });
    if (error) return setErr(error.message);
    setManualDate(""); setManualAmt(""); setMsg("Ad spend saved.");
    fetchAdspend();
  };
  const removeSpendDay = async (date) => { await supabase.from("oddbrew_adspend").delete().eq("id", date); fetchAdspend(); };

  const runSync = async (full) => {
    setErr(null); setSyncResult(null); setShowHelp(false); setSyncing(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data.session && data.session.access_token;
      let total = 0, done = false, timeouts = 0;
      for (let round = 0; round < 80 && !done; round++) {
        const resp = await fetch("/api/sync-oddbrew" + (full && round === 0 ? "?full=1" : ""), {
          method: "POST", headers: { Authorization: "Bearer " + token },
        });
        let body = null;
        try { body = await resp.json(); } catch (e) { body = null; }
        if (!body) {
          if ((resp.status === 504 || resp.status === 502) && timeouts < 5) { timeouts++; setSyncResult(`Still syncing — ${total} so far…`); continue; }
          throw new Error("Sync endpoint not reachable (" + resp.status + ").");
        }
        if (!body.ok) { if (body.missing) setShowHelp(true); throw new Error(body.error || "Sync failed."); }
        total += body.fetched;
        done = body.done !== false;
        if (!done) setSyncResult(`Syncing… ${total} orders so far.`);
      }
      setSyncResult(`Pulled ${total} order${total === 1 ? "" : "s"} from the OddBrew store.`);
      await fetchOrders();
    } catch (e) {
      setErr(e.message || String(e));
    } finally {
      setSyncing(false);
    }
  };

  if (!ready) {
    return (
      <div className="page">
        <div className="page-head"><div><h1>OddBrew</h1></div></div>
        <div className="card">
          <h2>One-time database step needed</h2>
          <p className="muted">Run this in Supabase → SQL Editor, then refresh. (Also at <code>supabase/migrations/2026-07-oddbrew.sql</code>.)</p>
          <pre style={{ background: "var(--panel-2)", padding: 14, borderRadius: 8, overflowX: "auto", fontSize: 12 }}>{MIGRATION}</pre>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{cfg.storeName || "OddBrew"}</h1>
          <div className="sub">A separate Shopify store — its own orders, costs, revenue &amp; profit.</div>
        </div>
        <div className="pills">
          <button className={tab === "overview" ? "active" : ""} onClick={() => setTab("overview")}>Overview</button>
          <button className={tab === "invoices" ? "active" : ""} onClick={() => setTab("invoices")}>Supplier invoices</button>
        </div>
      </div>

      {err && <div className="notice bad mb">⚠️ {err}</div>}
      {msg && <div className="notice good mb">✅ {msg}</div>}

      {tab === "invoices" ? (
        <OddBrewInvoices user={user} orders={orders || []} cfg={cfg} />
      ) : (
      <>
      <div className="pills mb">
        {RANGES.map(([k, l]) => (
          <button key={k} className={range === k ? "active" : ""} onClick={() => setRange(k)}>{l}</button>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(158px, 1fr))", gap: 12 }}>
        <Stat label="Revenue" value={money(totals.revenue, cur)} sub={`${totals.orders} orders · ${money(totals.aov, cur)} avg`} accent="var(--c-revenue)" />
        <Stat label="Gross profit" value={money(totals.grossProfit, cur)} sub={totals.margin != null ? totals.margin.toFixed(1) + "% gross margin" : "—"} accent="var(--c-profit)" />
        <Stat label="Ad spend" value={money(adSpendRange, cur)} sub="Meta ads" accent="#e8934a" />
        <Stat label="Net profit" value={money(netAfterAds, cur)} sub="after fees, cogs, fixed & ads" accent={netTone} tone={netTone} />
        <Stat label="Net margin" value={netMargin != null ? netMargin.toFixed(1) + "%" : "—"} sub="net profit ÷ revenue" accent={netTone} tone={netTone} />
      </div>

      <div className="muted small mt" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span>Cost of goods: <b>{money(totals.cogs, cur)}</b></span>
        {totals.cogs > 0 && (
          <span className={"badge " + (totals.verifiedPct >= 99 ? "green" : totals.verifiedPct > 0 ? "blue" : "gray")}>
            {Math.round(totals.verifiedPct)}% invoice-verified
          </span>
        )}
        <span className="muted">· {totals.verifiedOrders}/{totals.orders} orders costed from invoices, the rest estimated from your size rules.</span>
      </div>

      <div className="card mt">
        <h3>Revenue &amp; net profit by month</h3>
        {monthly.length ? (
          <>
            <Legend items={[{ label: "Revenue", color: "var(--c-revenue)" }, { label: "Net profit", color: "var(--c-profit)" }]} />
            <GroupedBars
              currency={cur}
              data={monthlyNet.map((m) => ({ label: monthLabel(m.month), values: [m.revenue, m.profit] }))}
              series={[{ label: "Revenue", color: "var(--c-revenue)" }, { label: "Net profit", color: "var(--c-profit)" }]}
            />
          </>
        ) : (
          <div className="muted mt">No orders yet — sync the store or import a CSV below.</div>
        )}
      </div>

      <div className="grid two mt">
        <div className="card" style={{ margin: 0 }}>
          <h3>Sync from Shopify</h3>
          {connected ? (
            <>
              <div className="notice good mt small">✓ Connected to the OddBrew Shopify store.</div>
              <div className="row mt">
                <button className="btn primary" onClick={() => runSync(false)} disabled={syncing}>{syncing ? "Syncing…" : "⟳ Sync OddBrew now"}</button>
                <button className="btn" onClick={() => runSync(true)} disabled={syncing}>Full re-sync</button>
              </div>
              <div className="muted small mt"><a href="/api/oddbrew-auth" target="_blank" rel="noreferrer">Re-connect</a> if it ever stops working.</div>
            </>
          ) : (
            <>
              <div className="muted small mt">Connect the OddBrew store once, then orders sync automatically. Add the app's Client ID &amp; Secret in Vercel first (see below).</div>
              <a className="btn primary mt" href="/api/oddbrew-auth" target="_blank" rel="noreferrer" style={{ display: "inline-flex" }}>🔗 Connect OddBrew Shopify</a>
            </>
          )}
          {syncResult && <div className="notice good mt small">{syncResult}</div>}
          {(showHelp || !connected) && (
            <div className="notice mt small">
              In Vercel → Settings → Environment Variables (then redeploy):
              <ul style={{ margin: "6px 0 0 16px" }}>
                <li><code>ODDBREW_SHOPIFY_STORE_DOMAIN</code> — e.g. <code>oddbrew.myshopify.com</code></li>
                <li><code>ODDBREW_SHOPIFY_CLIENT_ID</code> — the Dev Dashboard app's Client ID</li>
                <li><code>ODDBREW_SHOPIFY_CLIENT_SECRET</code> — its Secret (<code>shpss_…</code>)</li>
              </ul>
              And in the Dev Dashboard app, add this as an allowed redirect URL: <code>{window.location.origin}/api/oddbrew-auth</code>
            </div>
          )}
        </div>

        <div className="card" style={{ margin: 0 }}>
          <h3>Import history (CSV)</h3>
          <div className="muted small mt">Shopify Admin → Orders → Export → CSV. Drop as many as you like — re-importing the same orders is safe.</div>
          <label className="field mt">
            <span className="lab">Shopify orders export</span>
            <input ref={fileRef} type="file" accept=".csv,text/csv" multiple onChange={(e) => importFiles(e.target.files)} disabled={busy} />
          </label>
          {busy && <div className="muted small">Importing…</div>}
        </div>
      </div>

      <div className="card mt">
        <h3>Costs &amp; fees</h3>
        <div className="muted small mb">Shopify fees + fixed overhead. Per-product costs are set below; the COGS % and cost/order here are optional extras on top.</div>
        <div className="form-row">
          <label className="field"><span className="lab">Store name</span>
            <input type="text" value={cfg.storeName} onChange={(e) => setField(["storeName"], e.target.value)} /></label>
          <label className="field"><span className="lab">Currency</span>
            <select value={cfg.currency} onChange={(e) => setField(["currency"], e.target.value)}>
              <option>GBP</option><option>USD</option><option>EUR</option>
            </select></label>
        </div>
        <div className="form-row">
          <label className="field"><span className="lab">Shopify payment %</span>
            <input type="number" step="0.1" value={cfg.shopify.paymentPct} onChange={(e) => setField(["shopify", "paymentPct"], numField(e.target.value))} /></label>
          <label className="field"><span className="lab">Payment fixed ({cur})</span>
            <input type="number" step="0.01" value={cfg.shopify.paymentFixed} onChange={(e) => setField(["shopify", "paymentFixed"], numField(e.target.value))} /></label>
        </div>
        <div className="form-row">
          <label className="field"><span className="lab">Cost of goods (% of revenue)</span>
            <input type="number" step="1" value={cfg.cogsPct} onChange={(e) => setField(["cogsPct"], numField(e.target.value))} /></label>
          <label className="field"><span className="lab">Cost per order ({cur})</span>
            <input type="number" step="0.01" value={cfg.costPerOrder} onChange={(e) => setField(["costPerOrder"], numField(e.target.value))} /></label>
          <label className="field"><span className="lab">Fixed monthly ({cur})</span>
            <input type="number" step="1" value={cfg.fixedMonthly} onChange={(e) => setField(["fixedMonthly"], numField(e.target.value))} /></label>
        </div>
        <button className="btn primary mt" onClick={() => saveCfg(cfg)}>Save costs</button>
      </div>

      <div className="card mt">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 8 }}>
          <div>
            <h3 style={{ marginBottom: 2 }}>Product costs by size</h3>
            <div className="muted small">Cost per item = product cost + shipping for the destination. Matched by the size text in each order's variant name.</div>
          </div>
          <div className="row" style={{ gap: 6 }}>
            {!rules.length && <button className="btn small" onClick={seedRules}>Load OMGO sizes</button>}
            <button className="btn small" onClick={addRule}>+ Add size</button>
          </div>
        </div>

        {rules.length > 0 && (
          <div className="table-wrap mt">
            <table className="data">
              <thead><tr><th>Size</th><th>Variant contains</th><th className="num">Product</th><th className="num">Ship UK</th><th className="num">Ship US</th><th className="num">Ship Europe</th><th></th></tr></thead>
              <tbody>
                {rules.map((r, i) => (
                  <tr key={r.id || i}>
                    <td><input type="text" value={r.label} onChange={(e) => updateRule(i, { label: e.target.value })} placeholder="350ml" style={{ width: 76 }} /></td>
                    <td><input type="text" value={r.match} onChange={(e) => updateRule(i, { match: e.target.value })} placeholder="350ml" style={{ width: 110 }} /></td>
                    <td className="num"><input type="number" step="0.01" value={r.productCost} onChange={(e) => updateRule(i, { productCost: numField(e.target.value) })} style={{ width: 68 }} /></td>
                    <td className="num"><input type="number" step="0.01" value={r.shipUK} onChange={(e) => updateRule(i, { shipUK: numField(e.target.value) })} style={{ width: 68 }} /></td>
                    <td className="num"><input type="number" step="0.01" value={r.shipUS} onChange={(e) => updateRule(i, { shipUS: numField(e.target.value) })} style={{ width: 68 }} /></td>
                    <td className="num"><input type="number" step="0.01" value={r.shipEU} onChange={(e) => updateRule(i, { shipEU: numField(e.target.value) })} style={{ width: 68 }} /></td>
                    <td><button className="btn small danger" onClick={() => removeRule(i)}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="form-row mt">
          <label className="field" style={{ maxWidth: 260 }}>
            <span className="lab">Cost → store-currency rate</span>
            <input type="number" step="0.01" value={cfg.costFx} onChange={(e) => setField(["costFx"], numField(e.target.value))} />
            <span className="hint">Multiplies every cost above. The OMGO sheet is in USD — if the store is in {cur}, set e.g. 0.79. Leave 1 if same currency.</span>
          </label>
          <label className="field" style={{ flex: 1 }}>
            <span className="lab">Ignore products containing</span>
            <input type="text" value={(cfg.excludeProducts || []).join(", ")} onChange={(e) => setField(["excludeProducts"], e.target.value.split(",").map((s) => s.trim()).filter(Boolean))} placeholder="e.g. Lamp, Lumiscence, Solace" />
            <span className="hint">Comma-separated keywords. Orders that are <i>only</i> these products drop out of OddBrew entirely — for stock from a previous store. Ignores case &amp; spaces.</span>
          </label>
        </div>

        <div className="muted small mt">Regions: <b>UK</b> = GB · <b>US</b> = US · <b>Europe / rest</b> = everywhere else. Shipping is counted per item. Matching ignores case &amp; spaces.</div>
        {totals.unmatched > 0 && rules.length > 0 && (
          <div className="notice mt small">
            ⚠️ {totals.unmatched} sold item(s) didn't match any size rule — counted as {money(0, cur)}. Here's exactly what's unmatched — hit <b>+ rule</b> to add one (it prefills the size, then set the costs):
            <div className="table-wrap mt" style={{ maxHeight: 240, overflowY: "auto" }}>
              <table className="data">
                <thead><tr><th>Unmatched variant</th><th className="num">Qty</th><th></th></tr></thead>
                <tbody>
                  {unmatchedItems.map((u) => (
                    <tr key={u.name}>
                      <td className="small">{u.name}</td>
                      <td className="num">{u.qty}</td>
                      <td className="num">
                        <span className="row" style={{ justifyContent: "flex-end", gap: 6 }}>
                          <button className="btn small" onClick={() => addRuleFrom(u.name)}>+ rule</button>
                          <button className="btn small" onClick={() => excludeItem(u.name)} title="Not one of my products — ignore it">Not mine</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <button className="btn primary mt" onClick={() => saveCfg(cfg)}>Save product costs</button>
      </div>

      <div className="card mt">
        <h3>Ad spend (Meta)</h3>
        {!adReady ? (
          <div className="notice mt small">Run <code>supabase/migrations/2026-07-oddbrew-adspend.sql</code> in Supabase, then refresh, to track ad spend.</div>
        ) : (
          <>
            <div className="muted small mt">In Meta Ads Manager set the date range to <b>a single month</b>, export the campaign table (Export → CSV), and drop it here. It reads the total for that month. Re-importing a month just updates it. Comes straight off Net profit. (If your export has a per-day breakdown, that works too.)</div>
            <label className="field mt">
              <span className="lab">Ads Manager spend CSV</span>
              <input ref={adFileRef} type="file" accept=".csv,text/csv" multiple onChange={(e) => importAdSpend(e.target.files)} disabled={busy} />
            </label>
            <div className="form-row">
              <label className="field"><span className="lab">Or add a month manually</span><input type="month" value={manualDate} onChange={(e) => setManualDate(e.target.value)} /></label>
              <label className="field"><span className="lab">Amount ({cur})</span><input type="number" step="0.01" value={manualAmt} onChange={(e) => setManualAmt(e.target.value)} /></label>
              <div className="field" style={{ justifyContent: "flex-end" }}><button className="btn" onClick={addManualSpend}>Add</button></div>
            </div>
            <div className="muted small mt"><b>{money(adSpendRange, cur)}</b> in the selected range · {(adspend || []).length} entr{(adspend || []).length === 1 ? "y" : "ies"} recorded total.</div>
            {(adspend || []).length > 0 && (
              <div className="table-wrap mt">
                <table className="data">
                  <thead><tr><th>Date</th><th className="num">Spend</th><th>Source</th><th></th></tr></thead>
                  <tbody>
                    {[...adspend].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8).map((s) => (
                      <tr key={s.id}>
                        <td>{s.month || s.date}</td>
                        <td className="num">{money(s.amount, cur)}</td>
                        <td className="small muted">{s.source === "manual" ? "Manual" : "Meta CSV"}</td>
                        <td className="num"><button className="btn small danger" onClick={() => removeSpendDay(s.id)}>✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {adspend.length > 8 && <div className="muted small mt">Showing 8 most recent of {adspend.length} days.</div>}
              </div>
            )}
          </>
        )}
      </div>
      </>
      )}
    </div>
  );
}
