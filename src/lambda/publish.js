// Assemble + publish approved items.
//
// POST /.netlify/functions/publish            → publish all due approved items
// POST /.netlify/functions/publish { "id": "..." } → publish one specific item
//
// Schedule this a few times a day (cron) to drain the approved queue, or call
// it per-item from the dashboard. Only `approved` items whose scheduledFor has
// passed (or is unset) are published. TikTok goes to drafts; Instagram posts.

import { store } from "./lib/store.js"
import { assembleVideo } from "./lib/assemble.js"
import { publishInstagramReel, pushTikTokDraft } from "./lib/publishers.js"

const TARGETS = (process.env.PUBLISH_TARGETS || "instagram,tiktok").split(",").map(s => s.trim())

async function publishItem(item) {
  // 1. Render the video and host it at a public URL.
  const { videoUrl } = await assembleVideo(item)
  const caption = `${item.content.caption}\n\n${item.content.hashtags.map(h => `#${h}`).join(" ")}`

  // 2. Push to each configured platform, collecting per-target results.
  const results = []
  for (const target of TARGETS) {
    try {
      if (target === "instagram") results.push(await publishInstagramReel({ videoUrl, caption }))
      else if (target === "tiktok") results.push(await pushTikTokDraft({ videoUrl }))
    } catch (err) {
      results.push({ platform: target, error: err.message })
    }
  }

  item.assets = { videoUrl }
  item.publishResults = results
  item.status = results.every(r => r.error) ? "failed" : "published"
  item.publishedAt = Date.now()
  await store.put(item)
  return item
}

export async function handler(event) {
  try {
    const body = event.body ? JSON.parse(event.body) : {}
    const now = Date.now()

    let queue
    if (body.id) {
      const one = await store.get(body.id)
      if (!one) return { statusCode: 404, body: JSON.stringify({ error: "Not found" }) }
      queue = [one]
    } else {
      // All approved items that are due (no schedule, or schedule has passed).
      queue = (await store.list({ status: "approved" })).filter(
        i => !i.scheduledFor || i.scheduledFor <= now,
      )
    }

    const published = []
    for (const item of queue) published.push(await publishItem(item))

    return {
      statusCode: 200,
      body: JSON.stringify({ published: published.map(i => ({ id: i.id, status: i.status, results: i.publishResults })) }),
    }
  } catch (err) {
    console.log(err)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
