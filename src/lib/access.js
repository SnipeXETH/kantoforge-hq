// Per-user page access. Admins always see everything. A member is "full" by
// default; an admin can set them "limited" to a chosen set of pages. We also
// use this to avoid even fetching data a limited user isn't allowed to see.

export const ALL_PAGES = [
  "dashboard", "analytics", "monthly", "orders", "costs", "pricing",
  "commissions", "studio", "raffles", "tasks", "printshop", "oddbrew", "team", "settings",
];

export const PAGE_LABELS = {
  dashboard: "Dashboard", analytics: "Analytics", monthly: "Monthly figures",
  orders: "Orders", costs: "Costs", pricing: "Pricing calculator",
  commissions: "Commissions", studio: "Product images", raffles: "Competitions", tasks: "Tasks",
  printshop: "Print shop", oddbrew: "OddBrew", team: "Team", settings: "Settings",
};

// Private sections: hidden from EVERYONE (including admins) unless a user is
// explicitly granted access. This is how we lock a section to a named few.
export const RESTRICTED_PAGES = ["printshop", "oddbrew"];
const isRestricted = (p) => RESTRICTED_PAGES.includes(p);

// Which Supabase tables each page needs — used to minimise what a limited
// user's browser downloads. profiles + app_settings are always fetched.
export const PAGE_TABLES = {
  dashboard: ["orders", "product_costs", "fixed_costs", "competitions", "raffle_entries"],
  analytics: ["orders", "product_costs", "fixed_costs"],
  monthly: ["monthly_figures"],
  orders: ["orders", "product_costs", "fixed_costs"],
  costs: ["orders", "product_costs", "fixed_costs"],
  pricing: [],
  commissions: ["commissions"],
  studio: [],
  raffles: ["competitions", "raffle_entries"],
  tasks: ["tasks"],
  printshop: [], // its mockups live in their own table, fetched by the page
  oddbrew: [], // its orders/config live in their own tables, fetched by the page
  team: [],
  settings: [],
};

// Sections mirror the sidebar. Team + Settings are admin-only and never
// assignable to a member here (make someone an admin to grant those).
export const PAGE_SECTIONS = [
  { title: "Overview", pages: ["dashboard"] },
  { title: "Financials", pages: ["monthly", "analytics", "orders", "costs", "pricing"] },
  { title: "Studio", pages: ["commissions", "studio"] },
  { title: "Raffles", pages: ["raffles"] },
  { title: "Team", pages: ["tasks"] },
];

export const ADMIN_ONLY_PAGES = ["team", "settings"];
export const ASSIGNABLE_PAGES = PAGE_SECTIONS.reduce((a, s) => a.concat(s.pages), []);

// Quick presets for common roles on the team.
export const ACCESS_PRESETS = [
  { key: "ops", label: "Operations", pages: ["dashboard", "orders", "commissions", "tasks"] },
  { key: "finance", label: "Finance", pages: ["dashboard", "monthly", "analytics", "orders", "costs", "pricing"] },
  { key: "artist", label: "Artist", pages: ["commissions", "studio"] },
  { key: "commissions", label: "Commissions only", pages: ["commissions"] },
];

// Private sections a user has been explicitly granted.
export function grantsOf(user) {
  const g = user && user.access && Array.isArray(user.access.grants) ? user.access.grants : [];
  return g.filter((p) => RESTRICTED_PAGES.includes(p));
}

export function hasSection(user, page) {
  return allowedPages(user).includes(page);
}

export function allowedPages(user) {
  if (!user) return [];
  const openPages = ALL_PAGES.filter((p) => !isRestricted(p));
  let base;
  if (user.role === "admin") {
    base = openPages;
  } else {
    const a = user.access;
    if (!a || a.mode !== "limited") {
      base = openPages; // default = full access to the open sections
    } else {
      const pages = (a.pages || []).filter((p) => openPages.includes(p));
      base = pages.length ? pages : ["commissions"]; // never lock a user out entirely
    }
  }
  // add any private sections this user has been granted (applies to admins too)
  const grants = grantsOf(user).filter((p) => !base.includes(p));
  return base.concat(grants);
}

export function isLimited(user) {
  return user && user.role !== "admin" && user.access && user.access.mode === "limited";
}

// Set of tables this user is allowed to load (admins/full users: everything).
export function allowedTables(user) {
  if (!user || user.role === "admin" || !isLimited(user)) return null; // null = all
  const set = new Set();
  for (const p of allowedPages(user)) (PAGE_TABLES[p] || []).forEach((t) => set.add(t));
  return set;
}
