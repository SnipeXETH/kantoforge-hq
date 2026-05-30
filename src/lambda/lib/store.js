// Queue store for the auto-content pipeline.
//
// Netlify Functions are stateless and ephemeral, so the queue needs to live
// somewhere durable. This module exposes a small async interface and ships a
// JSON-file implementation (under /tmp) that works for local dev and demos.
//
// For production, swap `fileStore` for a real backend — the interface is
// intentionally tiny. Recommended options:
//   - Netlify Blobs (`@netlify/blobs`) — zero-infra, lives with the functions
//   - DynamoDB / Supabase / Postgres — if you already run one
// Implement the same five methods and re-export it as `store` below.

import fs from "fs"
import os from "os"
import path from "path"

const DB_PATH = process.env.QUEUE_DB_PATH || path.join(os.tmpdir(), "reels-queue.json")

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(DB_PATH, "utf8"))
  } catch (err) {
    if (err.code === "ENOENT") return []
    throw err
  }
}

function writeAll(items) {
  fs.writeFileSync(DB_PATH, JSON.stringify(items, null, 2))
}

export const fileStore = {
  async list(filter = {}) {
    let items = readAll()
    if (filter.status) items = items.filter(i => i.status === filter.status)
    return items.sort((a, b) => b.createdAt - a.createdAt)
  },

  async get(id) {
    return readAll().find(i => i.id === id) || null
  },

  async put(item) {
    const items = readAll()
    const idx = items.findIndex(i => i.id === item.id)
    if (idx === -1) items.push(item)
    else items[idx] = item
    writeAll(items)
    return item
  },

  async putMany(newItems) {
    const items = readAll()
    for (const item of newItems) items.push(item)
    writeAll(items)
    return newItems
  },

  async remove(id) {
    writeAll(readAll().filter(i => i.id !== id))
  },
}

// The active store. Re-point this line to your production backend.
export const store = fileStore
