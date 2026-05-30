// Review dashboard for the auto-reels pipeline.
//
// Generate-and-approve workflow: the pipeline fills a queue with `pending`
// ideas; you review, optionally edit the caption, then approve or reject.
// Approved items get rendered and published by the publish function.
//
// Drop <ReviewDashboard /> into your app (e.g. render it from App.js) and run
// the functions locally with `yarn start:lambda`.

import React, { useCallback, useEffect, useState } from "react"

const fn = name => `/.netlify/functions/${name}`

export default function ReviewDashboard() {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  const [niche, setNiche] = useState("")

  const load = useCallback(async () => {
    const res = await fetch(fn("queue"))
    const { items } = await res.json()
    setItems(items || [])
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const generate = async () => {
    setLoading(true)
    try {
      await fetch(fn("generate-content"), {
        method: "POST",
        body: JSON.stringify(niche ? { niche } : {}),
      })
      await load()
    } finally {
      setLoading(false)
    }
  }

  const review = async (id, action) => {
    await fetch(fn("review"), { method: "POST", body: JSON.stringify({ id, action }) })
    await load()
  }

  const publish = async id => {
    await fetch(fn("publish"), { method: "POST", body: JSON.stringify({ id }) })
    await load()
  }

  const pending = items.filter(i => i.status === "pending")
  const approved = items.filter(i => i.status === "approved")

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: 24, textAlign: "left", fontFamily: "system-ui" }}>
      <h1>Reels &amp; TikTok queue</h1>

      <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
        <input
          value={niche}
          onChange={e => setNiche(e.target.value)}
          placeholder="Niche (optional, e.g. home espresso for beginners)"
          style={{ flex: 1, padding: 8 }}
        />
        <button onClick={generate} disabled={loading}>
          {loading ? "Generating…" : "Generate batch"}
        </button>
      </div>

      <h2>Pending review ({pending.length})</h2>
      {pending.map(item => (
        <Card key={item.id}>
          <Content item={item} />
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={() => review(item.id, "approve")}>Approve</button>
            <button onClick={() => review(item.id, "reject")}>Reject</button>
          </div>
        </Card>
      ))}

      <h2 style={{ marginTop: 32 }}>Approved — ready to publish ({approved.length})</h2>
      {approved.map(item => (
        <Card key={item.id}>
          <Content item={item} />
          <button onClick={() => publish(item.id)} style={{ marginTop: 12 }}>
            Render &amp; publish now
          </button>
        </Card>
      ))}
    </div>
  )
}

function Card({ children }) {
  return <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 16, marginBottom: 16 }}>{children}</div>
}

function Content({ item }) {
  const c = item.content
  return (
    <div>
      <strong>{c.title}</strong> <span style={{ color: "#888" }}>· ~{c.estimated_seconds}s</span>
      <p style={{ fontStyle: "italic", margin: "8px 0" }}>Hook: {c.hook}</p>
      <ol style={{ margin: "8px 0", paddingLeft: 20 }}>
        {c.script.map((beat, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            <div>{beat.voiceover}</div>
            <div style={{ color: "#666", fontSize: 13 }}>
              text: “{beat.on_screen_text}” · visual: {beat.visual}
            </div>
          </li>
        ))}
      </ol>
      <p style={{ margin: "8px 0" }}>CTA: {c.cta}</p>
      <p style={{ color: "#444", fontSize: 14 }}>{c.caption}</p>
      <p style={{ color: "#2a7", fontSize: 13 }}>{c.hashtags.map(h => `#${h}`).join(" ")}</p>
      <p style={{ color: "#888", fontSize: 13 }}>Audio: {c.suggested_audio}</p>
    </div>
  )
}
