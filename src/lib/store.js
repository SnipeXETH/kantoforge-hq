// Local data store for KantoForge HQ.
// Everything persists to localStorage under one versioned key so it can be
// exported/imported as a single backup file (Settings → Data).
const KEY = "kf_data_v1";
const SESSION_KEY = "kf_session_v1";

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

function emptyDb() {
  return {
    users: [],
    orders: [],
    productCosts: [],
    fixedCosts: [],
    tasks: [],
    settings: DEFAULT_SETTINGS,
  };
}

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

export function loadDb() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyDb();
    const parsed = JSON.parse(raw);
    return { ...emptyDb(), ...parsed, settings: mergeSettings(parsed.settings) };
  } catch (e) {
    console.error("Failed to load data", e);
    return emptyDb();
  }
}

export function saveDb(db) {
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
  } catch (e) {
    console.error("Failed to save data", e);
  }
}

export function exportBackup(db) {
  return JSON.stringify({ app: "kantoforge-hq", version: 1, exportedAt: new Date().toISOString(), data: db }, null, 2);
}

export function parseBackup(text) {
  const parsed = JSON.parse(text);
  const data = parsed && parsed.app === "kantoforge-hq" ? parsed.data : parsed;
  if (!data || !Array.isArray(data.orders) || !Array.isArray(data.users)) {
    throw new Error("This file doesn't look like a KantoForge HQ backup.");
  }
  return { ...emptyDb(), ...data, settings: mergeSettings(data.settings) };
}

export function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch (e) {
    return null;
  }
}

export function saveSession(session) {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
}
