// Approve or reject a queued idea from the review dashboard.
// POST /.netlify/functions/review  { "id": "...", "action": "approve" | "reject",
//                                    "edits": { ...partial content... },
//                                    "scheduledFor": 1735689600000 }
//
// Approving marks the item ready for assembly + publishing. It does NOT publish
// immediately — the publish step (manual or scheduled) picks up approved items.

import { store } from "./lib/store.js"

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Use POST" }) }
    }

    const { id, action, edits, scheduledFor } = JSON.parse(event.body || "{}")
    if (!id || !["approve", "reject"].includes(action)) {
      return { statusCode: 400, body: JSON.stringify({ error: "id and action (approve|reject) required" }) }
    }

    const item = await store.get(id)
    if (!item) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) }

    // Let the reviewer tweak the copy before approving.
    if (edits) item.content = { ...item.content, ...edits }
    if (scheduledFor) item.scheduledFor = scheduledFor

    item.status = action === "approve" ? "approved" : "rejected"
    item.reviewedAt = Date.now()

    await store.put(item)
    return { statusCode: 200, body: JSON.stringify({ item }) }
  } catch (err) {
    console.log(err)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
