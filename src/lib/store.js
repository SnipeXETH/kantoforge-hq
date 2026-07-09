// Data layer for KantoForge HQ, backed by Supabase.
// The app holds the whole database in memory as `db` and re-renders from it;
// `syncDb` diffs the previous and next states and pushes only what changed.
import { supabase } from "./supabase";

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
    if (saved[k] && typeof saved[k] === "object" && out[k] && typeof out[k] === "object") {
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
  ["fixedCosts", "fixed_costs"],
  ["tasks", "tasks"],
  ["monthlyFigures", "monthly_figures"],
  ["commissions", "commissions"],
];

const CHUNK = 400;

function rowFor(table, item) {
  if (table === "orders") return { id: item.id, platform: item.platform, order_date: item.date || null, data: item };
  return { id: item.id, data: item };
}

async function must(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

// Supabase caps any single query at 1000 rows (PostgREST max-rows), so a store
// with thousands of orders would silently load only the newest 1000. Page
// through in 1000-row windows with .range() until a short page ends it.
const PAGE = 1000;
async function fetchAll(table, { select = "data", order } = {}) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from(table).select(select).range(from, from + PAGE - 1);
    if (order) q = q.order(order.column, { ascending: order.ascending });
    const batch = await must(q);
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }
  return rows;
}

export async function fetchDb() {
  const [profiles, orders, productCosts, fixedCosts, tasks, settingsRow] = await Promise.all([
    fetchAll("profiles", { select: "*", order: { column: "created_at", ascending: true } }),
    fetchAll("orders", { select: "data", order: { column: "order_date", ascending: false } }),
    fetchAll("product_costs"),
    fetchAll("fixed_costs"),
    fetchAll("tasks"),
    must(supabase.from("app_settings").select("data").eq("id", 1).maybeSingle()),
  ]);
  // monthly_figures was added later — tolerate the table not existing yet so
  // the rest of the app keeps working; the page shows migration instructions.
  let monthlyFigures = [];
  let monthlyFiguresReady = true;
  try {
    const rows = await fetchAll("monthly_figures");
    monthlyFigures = rows.map((r) => r.data).sort((a, b) => (b.id || "").localeCompare(a.id || ""));
  } catch (e) {
    monthlyFiguresReady = false;
  }

  // commissions was added later too — tolerate the table not existing yet
  let commissions = [];
  let commissionsReady = true;
  try {
    const rows = await fetchAll("commissions");
    commissions = rows.map((r) => r.data).sort((a, b) => (b.requestedAt || "").localeCompare(a.requestedAt || ""));
  } catch (e) {
    commissionsReady = false;
  }

  return {
    users: profiles.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, badges: p.badges || [], createdAt: p.created_at })),
    orders: orders.map((r) => r.data),
    productCosts: productCosts.map((r) => r.data),
    fixedCosts: fixedCosts.map((r) => r.data),
    tasks: tasks.map((r) => r.data).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
    monthlyFigures,
    monthlyFiguresReady,
    commissions,
    commissionsReady,
    settings: mergeSettings(settingsRow ? settingsRow.data : null),
  };
}

// Push the difference between two db states to Supabase. Slices that kept
// their object identity are untouched; within a changed slice, items are
// compared by reference and matched by id.
export async function syncDb(prev, next) {
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
      jobs.push(must(supabase.from(table).upsert(upserts.slice(i, i + CHUNK))));
    }
    if (deletes.length) jobs.push(must(supabase.from(table).delete().in("id", deletes)));
  }
  if (prev.settings !== next.settings) {
    jobs.push(must(supabase.from("app_settings").upsert({ id: 1, data: next.settings })));
  }
  if (prev.users !== next.users) {
    const prevById = new Map(prev.users.map((u) => [u.id, u]));
    for (const u of next.users) {
      const p = prevById.get(u.id);
      if (!p) continue;
      const patch = {};
      if (p.role !== u.role) patch.role = u.role;
      if (JSON.stringify(p.badges || []) !== JSON.stringify(u.badges || [])) patch.badges = u.badges || [];
      if (Object.keys(patch).length) jobs.push(must(supabase.from("profiles").update(patch).eq("id", u.id)));
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
      jobs.push(must(supabase.from(table).upsert(rows.slice(i, i + CHUNK))));
    }
  }
  jobs.push(must(supabase.from("app_settings").upsert({ id: 1, data: mergeSettings(data.settings) })));
  await Promise.all(jobs);
}

export async function wipeData() {
  await Promise.all(TABLE_MAP.map(([, table]) => must(supabase.from(table).delete().neq("id", ""))));
  await must(supabase.from("app_settings").upsert({ id: 1, data: {} }));
}
