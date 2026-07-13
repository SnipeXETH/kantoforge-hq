// Per-user page access. Admins always see everything. A member is "full" by
// default; an admin can set them "limited" to a chosen set of pages. We also
// use this to avoid even fetching data a limited user isn't allowed to see.

export const ALL_PAGES = [
  "dashboard", "analytics", "monthly", "orders", "costs", "pricing",
  "commissions", "raffles", "tasks", "team", "settings",
];

export const PAGE_LABELS = {
  dashboard: "Dashboard", analytics: "Analytics", monthly: "Monthly figures",
  orders: "Orders", costs: "Costs", pricing: "Pricing calculator",
  commissions: "Commissions", raffles: "Competitions", tasks: "Tasks",
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
  raffles: ["competitions", "raffle_entries"],
  tasks: ["tasks"],
  team: [],
  settings: [],
};

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
