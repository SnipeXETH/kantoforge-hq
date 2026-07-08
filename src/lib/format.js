const SYMBOLS = { GBP: "£", USD: "$", EUR: "€" };

export function money(n, currency = "GBP") {
  if (n == null || isNaN(n)) return "—";
  const sym = SYMBOLS[currency] || currency + " ";
  const neg = n < 0;
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return (neg ? "-" : "") + sym + s;
}

export function moneyCompact(n, currency = "GBP") {
  if (n == null || isNaN(n)) return "—";
  const sym = SYMBOLS[currency] || currency + " ";
  const neg = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000000) return neg + sym + (abs / 1000000).toFixed(1) + "M";
  if (abs >= 10000) return neg + sym + Math.round(abs / 1000) + "k";
  if (abs >= 1000) return neg + sym + (abs / 1000).toFixed(1) + "k";
  return neg + sym + Math.round(abs);
}

export function pct(n, dp = 1) {
  if (n == null || isNaN(n) || !isFinite(n)) return "—";
  return n.toFixed(dp) + "%";
}

export function shortDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function monthLabel(key) {
  // key = "2026-03"
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString("en-GB", { month: "short", year: "2-digit" });
}

export function monthKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
