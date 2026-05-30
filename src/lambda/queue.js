// List queue items for the review dashboard.
// GET /.netlify/functions/queue            → all items, newest first
// GET /.netlify/functions/queue?status=pending → only pending items

import { store } from "./lib/store.js"

export async function handler(event) {
  try {
    const status = event.queryStringParameters && event.queryStringParameters.status
    const items = await store.list(status ? { status } : {})
    return { statusCode: 200, body: JSON.stringify({ items }) }
  } catch (err) {
    console.log(err)
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) }
  }
}
