// Data layer for KantoForge HQ, backed by Supabase.
// The app holds the whole database in memory as `db` and re-renders from it;
// `syncDb` diffs the previous and next states and pushes only what changed.
import { supabase } from "./supabase";
import { allowedTables } from "./access";

export const DEFAULT_SETTINGS = {
  currency: "GBP",
  etsy: {
    transactionPct: 6.5, // % of item value + postage, after discounts
    paymentPct: 4.0, // Etsy Payments UK
    paymentFixed: 0.2,
    listingFee: 0.16, // $0.20 renewal fee, approx in GBP — edit in Settings
    regulatoryPct: 0.32, // UK regulatory operating fee
    offsiteAdsPct: 15, // fee charged when an offsite ad converts
    offsiteAdsShare: 0, // % of your orders that come via offsite ads
  },
  shopify: {
    paymentPct: 1.7, // Shopify Payments UK online rate (Basic)
    paymentFixed: 0.25,
  },
  defaults: {
    packagingPerOrder: 0.6, // box, mailer, tape, insert
    postagePerOrderEtsy: 3.5, // what you actually pay to ship
    postagePerOrderShopify: 3.5,
    fallbackItemCost: 0, // used when no product cost rule matches
  },
  // Variable per-order costs expressed as a formula: pct % of a base amount +
  // a fixed amount, optionally scoped by platform/region. e.g. fulfilment fees,
  // DDP. Each: { id, label, pct, base, fixed, platform, region, enabled }
  costRules: [],
  // Which grand total to take from an uploaded fulfilment invoice: 'incl' VAT
  // or 'excl' VAT (if you reclaim it).
  fulfilmentVat: "incl",
  // months manually marked "no sales" on the import coverage grid,
  // keyed "YYYY-MM:platform"
  coverageMarks: {},
  // profit split applied to monthly figures' net profit
  partner: { label: "Alula", pct: 40 },
  // date the Etsy→Shopify integration went live: Etsy orders from this day
  // onwards exist in Shopify, so Etsy CSV imports only accept earlier orders
  // (prevents the same sale being counted twice)
  etsyCutover: "2024-11-16",
};

// Deep-merge saved settings over defaults so new settings fields added in
// future versions get sensible values for existing installs.
function mergeSettings(saved) {
  const out = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
  if (!saved) return out;
  for (const k of Object.keys(saved)) {
    if (Array.isArray(saved[k])) {
      out[k] = saved[k]; // replace arrays wholesale (e.g. costRules)
    } else if (saved[k] && typeof saved[k] === "object" && out[k] && typeof out[k] === "object") {
      out[k] = { ...out[k], ...saved[k] };
    } else {
      out[k] = saved[k];
    }
  }
  return out;
}

const TABLE_MAP = [
  ["orders", "orders"],
  ["productCosts", "product_costs"],
  ["fulfilment", "kf_fulfilment"],
  ["fixedCosts", "fixed_costs"],
  ["tasks", "tasks"],
  ["monthlyFigures", "monthly_figures"],
  ["commissions", "commissions"],
  ["competitions", "competitions"],
  ["raffleEntries", "raffle_entries"],
];

const CHUNK = 400;

function rowFor(table, item) {
  if (table === "orders") return { id: item.id, platform: item.platform, order_date: item.date || null, data: item };
  if (table === "raffle_entries") return { id: item.id, competition_id: item.competitionId || null, data: item };
  return { id: item.id, data: item };
}

// Preserve the Postgres/PostgREST error code on the thrown Error so callers can
// tell "table missing" from a transient failure.
function asError(error) {
  const e = new Error((error && error.message) || "Database error");
  if (error && error.code) e.code = error.code;
  return e;
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw asError(error);
  return data;
}

// Transient failures that clear on retry: deadlock (40P01), serialization
// (40001), statement timeout (57014) — e.g. a heavy write/read racing realtime
// replication or a concurrent refetch.
function isTransient(error) {
  const c = error && error.code;
  const m = (error && error.message) || "";
  return c === "40P01" || c === "40001" || c === "57014" || /deadlock|could not serialize|timeout/i.test(m);
}

// The table genuinely doesn't exist yet (so a migration really is needed) — as
// opposed to any other read failure, which must NOT be shown as "run migration".
export function tableMissing(error) {
  const c = error && error.code;
  const m = (error && error.message) || "";
  return c === "42P01" || c === "PGRST205" || /does not exist|could not find the table|schema cache/i.test(m);
}

// Run a query with a few backoff retries on transient failures. makeQuery must
// build a *fresh* query each call (a Supabase builder only runs once).
async function withRetry(makeQuery, tries = 6) {
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await makeQuery();
    if (!error) return data;
    if (!isTransient(error) || attempt >= tries) throw asError(error);
    await new Promise((r) => setTimeout(r, 120 * attempt * attempt)); // 120ms, 480, 1080, …
  }
}

// Supabase caps any single query at 1000 rows (PostgREST max-rows), so a store
// with thousands of orders would silently load only the newest 1000. Page
// through in windows with .range() until a short page ends it. Every page
// retries on transient failures.
const PAGE = 1000;
async function fetchAll(table, { select = "data", order, pageSize = PAGE } = {}) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const batch = await withRetry(() => {
      let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
      if (order) q = q.order(order.column, { ascending: order.ascending });
      return q;
    });
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}

export async function fetchDb(currentUserId) {
  // profiles + settings always load; from the current user's access we decide
  // which data tables to fetch at all, so a limited user's browser never even
  // downloads restricted data.
  const [profiles, settingsRow] = await Promise.all([
    fetchAll("profiles", { select: "*", order: { column: "created_at", ascending: true } }),
    must(supabase.from("app_settings").select("data").eq("id", 1).maybeSingle()),
  ]);
  const users = profiles.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, badges: p.badges || [], access: p.access || null, createdAt: p.created_at }));
  const me = users.find((u) => u.id === currentUserId) || null;
  const tables = allowedTables(me); // null = allowed everything
  const may = (t) => tables === null || tables.has(t);

  const [orders, productCosts, fixedCosts, tasks] = await Promise.all([
    may("orders") ? fetchAll("orders", { select: "data", order: { column: "order_date", ascending: false } }) : Promise.resolve([]),
    may("product_costs") ? fetchAll("product_costs") : Promise.resolve([]),
    may("fixed_costs") ? fetchAll("fixed_costs") : Promise.resolve([]),
    may("tasks") ? fetchAll("tasks") : Promise.resolve([]),
  ]);

  // Supplier fulfilment invoices (actual per-order postage/fee/DDP). Guarded so
  // a not-yet-migrated table doesn't break the whole load — just no actuals.
  let fulfilment = [];
  if (may("kf_fulfilment")) {
    try {
      const rows = await fetchAll("kf_fulfilment");
      fulfilment = rows.map((r) => r.data);
    } catch (e) {
      if (!tableMissing(e)) throw e;
    }
  }

  let monthlyFigures = [];
  let monthlyFiguresReady = true;
  let monthlyFiguresError = null;
  if (may("monthly_figures")) {
    try {
      const rows = await fetchAll("monthly_figures");
      monthlyFigures = rows.map((r) => r.data).sort((a, b) => (b.id || "").localeCompare(a.id || ""));
    } catch (e) {
      if (tableMissing(e)) monthlyFiguresReady = false;
      else monthlyFiguresError = e.message || String(e);
    }
  }

  let commissions = [];
  let commissionsReady = true;
  let commissionsError = null;
  if (may("commissions")) {
    try {
      const rows = await fetchAll("commissions");
      commissions = rows.map((r) => r.data).sort((a, b) => (b.requestedAt || "").localeCompare(a.requestedAt || ""));
    } catch (e) {
      if (tableMissing(e)) commissionsReady = false;
      else commissionsError = e.message || String(e);
    }
  }

  let competitions = [];
  let raffleEntries = [];
  let rafflesReady = true;
  let rafflesError = null;
  if (may("competitions") || may("raffle_entries")) {
    try {
      const [cs, es] = await Promise.all([fetchAll("competitions"), fetchAll("raffle_entries")]);
      competitions = cs.map((r) => r.data).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
      raffleEntries = es.map((r) => r.data);
    } catch (e) {
      if (tableMissing(e)) rafflesReady = false;
      else rafflesError = e.message || String(e);
    }
  }

  return {
    users,
    orders: orders.map((r) => r.data),
    productCosts: productCosts.map((r) => r.data),
    fulfilment,
    fixedCosts: fixedCosts.map((r) => r.data),
    tasks: tasks.map((r) => r.data).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    monthlyFigures,
    monthlyFiguresReady,
    monthlyFiguresError,
    commissions,
    commissionsReady,
    commissionsError,
    competitions,
    raffleEntries,
    rafflesReady,
    rafflesError,
    settings: mergeSettings(settingsRow ? settingsRow.data : null),
  };
}

// Push the difference between two db states to Supabase. Slices that kept
// their object identity are untouched; within a changed slice, items are
// compared by reference and matched by id.
//
// Calls are serialised (one at a time) so two rapid edits never issue
// overlapping write transactions that could deadlock each other, and every
// write retries on a transient deadlock.
let syncChain = Promise.resolve();
export function syncDb(prev, next) {
  const run = () => _syncDb(prev, next);
  syncChain = syncChain.then(run, run); // run even if a prior sync rejected
  return syncChain;
}

async function _syncDb(prev, next) {
  const jobs = [];
  for (const [key, table] of TABLE_MAP) {
    if (prev[key] === next[key]) continue;
    const prevById = new Map(prev[key].map((x) => [x.id, x]));
    const upserts = [];
    const seen = new Set();
    for (const item of next[key]) {
      seen.add(item.id);
      if (prevById.get(item.id) !== item) upserts.push(rowFor(table, item));
    }
    const deletes = prev[key].filter((x) => !seen.has(x.id)).map((x) => x.id);
    for (let i = 0; i < upserts.length; i += CHUNK) {
      const chunk = upserts.slice(i, i + CHUNK);
      jobs.push(withRetry(() => supabase.from(table).upsert(chunk)));
    }
    if (deletes.length) jobs.push(withRetry(() => supabase.from(table).delete().in("id", deletes)));
  }
  if (prev.settings !== next.settings) {
    jobs.push(withRetry(() => supabase.from("app_settings").upsert({ id: 1, data: next.settings })));
  }
  if (prev.users !== next.users) {
    const prevById = new Map(prev.users.map((u) => [u.id, u]));
    for (const u of next.users) {
      const p = prevById.get(u.id);
      if (!p) continue;
      const patch = {};
      if (p.role !== u.role) patch.role = u.role;
      if (JSON.stringify(p.badges || []) !== JSON.stringify(u.badges || [])) patch.badges = u.badges || [];
      if (JSON.stringify(p.access || null) !== JSON.stringify(u.access || null)) patch.access = u.access || null;
      if (Object.keys(patch).length) {
        const p2 = patch;
        jobs.push(withRetry(() => supabase.from("profiles").update(p2).eq("id", u.id)));
      }
    }
  }
  await Promise.all(jobs);
}

// --- Backup / restore -------------------------------------------------------

export function exportBackup(db) {
  return JSON.stringify(
    { app: "kantoforge-hq", version: 2, exportedAt: new Date().toISOString(), data: db },
    null,
    2
  );
}

export function parseBackup(text) {
  const parsed = JSON.parse(text);
  const data = parsed && parsed.app === "kantoforge-hq" ? parsed.data : parsed;
  if (!data || !Array.isArray(data.orders)) {
    throw new Error("This file doesn't look like a KantoForge HQ backup.");
  }
  return data;
}

// Replace all business data with the backup's. Accounts are not restored —
// they live in Supabase Auth, not in backups.
export async function importBackup(data) {
  await wipeData();
  const jobs = [];
  for (const [key, table] of TABLE_MAP) {
    const rows = (data[key] || []).filter((x) => x && x.id).map((x) => rowFor(table, x));
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      jobs.push(withRetry(() => supabase.from(table).upsert(chunk)));
    }
  }
  jobs.push(withRetry(() => supabase.from("app_settings").upsert({ id: 1, data: mergeSettings(data.settings) })));
  await Promise.all(jobs);
}

export async function wipeData() {
  await Promise.all(TABLE_MAP.map(([, table]) => withRetry(() => supabase.from(table).delete().neq("id", ""))));
  await withRetry(() => supabase.from("app_settings").upsert({ id: 1, data: {} }));
}
