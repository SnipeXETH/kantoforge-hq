// Shared competition helpers used by the admin, dashboard and public API logic.

export function ticketsSold(entries) {
  return entries.reduce((s, e) => s + Math.max(1, e.quantity || 1), 0);
}

// A competition auto-closes for entry once its close date passes or it sells
// out, even before an admin formally closes it. Draw/draft/drawn are unchanged.
export function effectiveStatus(c, sold, now) {
  if (c.status !== "open") return c.status;
  const t = now || Date.now();
  const past = c.closesAt && new Date(c.closesAt + "T23:59:59").getTime() < t;
  const full = c.maxTickets && sold >= c.maxTickets;
  return past || full ? "closed" : "open";
}

export function compFinancials(c, sold) {
  const raised = sold * (c.ticketPrice || 0);
  const prizeCost = c.prizeCost || 0;
  return {
    raised,
    prizeCost,
    profit: raised - prizeCost,
    soldPct: c.maxTickets ? (sold / c.maxTickets) * 100 : 0,
    remaining: Math.max(0, (c.maxTickets || 0) - sold),
  };
}

export function winnersCount(c) {
  return 1 + ((c.prizeTiers && c.prizeTiers.length) || 0);
}

// place 0 = main prize (the competition itself), 1+ = runner-up tiers
export function prizeForPlace(c, place) {
  if (place === 0) return c.title;
  return (c.prizeTiers && c.prizeTiers[place - 1]) || "Prize " + (place + 1);
}

export const PLACE_LABEL = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
