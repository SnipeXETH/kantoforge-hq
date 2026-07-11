/* global BigInt */
// Provably-fair prize draw (commit–reveal scheme).
//
// At competition creation we generate a random `serverSeed` and publish only
// its SHA-256 hash (the commit) — proving the seed was fixed in advance
// without revealing it. At draw time we optionally fold in a piece of public
// entropy the operator cannot control (e.g. a named future National Lottery
// result), derive the winning ticket deterministically, and reveal the seed.
// Anyone can then check sha256(serverSeed) matches the published hash and
// recompute the winning number — so the draw can't be rigged after the fact.

export function randomSeedHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256hex(str) {
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Sequentially number tickets across entries (in a stable order): entry 1 owns
// 1..q1, entry 2 owns q1+1..q1+q2, and so on.
export function allocateTickets(entries) {
  let cursor = 1;
  const ranges = entries.map((e) => {
    const q = Math.max(1, e.quantity || 1);
    const r = { entryId: e.id, name: e.name, from: cursor, to: cursor + q - 1, quantity: q };
    cursor += q;
    return r;
  });
  return { ranges, total: cursor - 1 };
}

export function ownerOfTicket(ranges, ticket) {
  return ranges.find((r) => ticket >= r.from && ticket <= r.to) || null;
}

// Deterministic winning ticket in [1, ticketsTotal].
export async function deriveWinningTicket(serverSeed, publicEntropy, ticketsTotal) {
  const finalHash = await sha256hex(serverSeed + ":" + (publicEntropy || ""));
  // Use the full 256-bit hash as a big integer to avoid modulo bias at any
  // realistic ticket count.
  const n = BigInt("0x" + finalHash);
  const winningTicket = Number(n % BigInt(ticketsTotal)) + 1;
  return { finalHash, winningTicket };
}

// Re-run the whole derivation from stored values to confirm a recorded draw.
export async function verifyDraw({ serverSeed, serverSeedHash, publicEntropy, ticketsTotal, winningTicket }) {
  const commitOk = (await sha256hex(serverSeed)) === serverSeedHash;
  const { winningTicket: recomputed, finalHash } = await deriveWinningTicket(serverSeed, publicEntropy, ticketsTotal);
  return { commitOk, ticketOk: recomputed === winningTicket, recomputed, finalHash };
}

// Draw `count` DISTINCT winning tickets deterministically (main prize + runner-ups).
// Winner i derives from sha256(seed:entropy:i); collisions probe forward so every
// winner is a different ticket. Fully reproducible from the revealed values.
export async function deriveWinners(serverSeed, publicEntropy, ticketsTotal, count) {
  const winners = [];
  const used = new Set();
  const cnt = Math.max(1, Math.min(count, ticketsTotal));
  for (let i = 0; winners.length < cnt; i++) {
    const finalHash = await sha256hex(serverSeed + ":" + (publicEntropy || "") + ":" + i);
    let ticket = Number(BigInt("0x" + finalHash) % BigInt(ticketsTotal)) + 1;
    while (used.has(ticket)) ticket = (ticket % ticketsTotal) + 1;
    used.add(ticket);
    winners.push({ place: winners.length, finalHash, winningTicket: ticket });
  }
  return winners;
}

export async function verifyWinners({ serverSeed, serverSeedHash, publicEntropy, ticketsTotal, winners }) {
  const commitOk = (await sha256hex(serverSeed)) === serverSeedHash;
  const recomputed = await deriveWinners(serverSeed, publicEntropy, ticketsTotal, winners.length);
  const ticketOk = recomputed.every((w, i) => w.winningTicket === winners[i].winningTicket);
  return { commitOk, ticketOk, recomputed };
}
