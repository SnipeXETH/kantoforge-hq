// Generate a batch of reel ideas and add them to the review queue as `pending`.
//
// Trigger this on a schedule (Netlify Scheduled Functions / EventBridge cron)
// a few times a day, or call it manually. Nothing is published here — every
// idea lands in the queue for human approval first.

import crypto from "crypto"
import { generateIdeas } from "./lib/generator.js"
import { store } from "./lib/store.js"

const DEFAULT_NICHE = process.env.CONTENT_NICHE || "everyday productivity tips"

export async function handler(event) {
  try {
    const body = event.body ? JSON.parse(event.body) : {}
    const niche = body.niche || DEFAULT_NICHE
    const count = body.count || Number(process.env.CONTENT_BATCH_SIZE || 4)

    // Avoid repeats: feed recent titles back into the prompt.
    const recent = await store.list()
    const recentTitles = recent.slice(0, 20).map(i => i.content.title)

    const ideas = await generateIdeas({ niche, count, recentTitles })

    const now = Date.now()
    const items = ideas.map(idea => ({
      id: crypto.randomUUID(),
      createdAt: now,
      status: "pending", // pending → approved → published (or rejected)
      niche,
      content: idea,
      assets: null, // populated by the assembly step after approval
      scheduledFor: null,
      publishResults: null,
    }))

    await store.putMany(items)

    return {
      statusCode: 200,
      body: JSON.stringify({ generated: items.length, ids: items.map(i => i.id) }),
    }
  } catch (err) {
    console.log(err)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
