// Per-user page access. Admins always see everything. A member is "full" by
// default; an admin can set them "limited" to a chosen set of pages. We also
// use this to avoid even fetching data a limited user isn't allowed to see.

export const ALL_PAGES = [
  "dashboard", "analytics", "monthly", "orders", "costs", "pricing",
  "commissions", "studio", "raffles", "tasks", "team", "settings",
];

export const PAGE_LABELS = {
  dashboard: "Dashboard", analytics: "Analytics", monthly: "Monthly figures",
  orders: "Orders", costs: "Costs", pricing: "Pricing calculator",
  commissions: "Commissions", studio: "Product images", raffles: "Competitions", tasks: "Tasks",
  team: "Team", settings: "Settings",
};

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

export function allowedPages(user) {
  if (!user) return [];
  if (user.role === "admin") return ALL_PAGES;
  const a = user.access;
  if (!a || a.mode !== "limited") return ALL_PAGES; // default = full access
  const pages = (a.pages || []).filter((p) => ALL_PAGES.includes(p));
  return pages.length ? pages : ["commissions"]; // never lock a user out entirely
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
