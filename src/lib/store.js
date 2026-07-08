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

export async function fetchDb() {
  const [profiles, orders, productCosts, fixedCosts, tasks, settingsRow] = await Promise.all([
    must(supabase.from("profiles").select("*").order("created_at", { ascending: true })),
    must(supabase.from("orders").select("data").order("order_date", { ascending: false })),
    must(supabase.from("product_costs").select("data")),
    must(supabase.from("fixed_costs").select("data")),
    must(supabase.from("tasks").select("data")),
    must(supabase.from("app_settings").select("data").eq("id", 1).maybeSingle()),
  ]);
  return {
    users: profiles.map((p) => ({ id: p.id, name: p.name, email: p.email, role: p.role, createdAt: p.created_at })),
    orders: orders.map((r) => r.data),
    productCosts: productCosts.map((r) => r.data),
    fixedCosts: fixedCosts.map((r) => r.data),
    tasks: tasks.map((r) => r.data).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")),
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
    const prevRole = new Map(prev.users.map((u) => [u.id, u.role]));
    for (const u of next.users) {
      if (prevRole.has(u.id) && prevRole.get(u.id) !== u.role) {
        jobs.push(must(supabase.from("profiles").update({ role: u.role }).eq("id", u.id)));
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
