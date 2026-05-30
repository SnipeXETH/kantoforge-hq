# Auto-content pipeline — Reels & TikTok (generate + approve queue)

An automated **production** pipeline with a **human approval gate**. The system
generates short-form video ideas with Claude, queues them, and lets you approve
(and lightly edit) each one before it's rendered and published. This is the
account-safe alternative to blind autopilot — see *Platform reality* below for
why that gate matters.

```
generate-content (cron/manual)        review (you)            publish (cron/manual)
  Claude → structured ideas  ──▶  pending → approved/rejected ──▶ assemble video → post
        store as "pending"            (dashboard)                 IG: live · TikTok: draft
```

## Pieces

| File | Role |
|---|---|
| `src/lambda/generate-content.js` | Generates a batch of ideas → queue as `pending` |
| `src/lambda/queue.js` | Lists queue items for the dashboard |
| `src/lambda/review.js` | Approve / reject (with optional caption edits + schedule) |
| `src/lambda/publish.js` | Renders + publishes due `approved` items |
| `src/lambda/lib/generator.js` | Claude call (adaptive thinking, prompt caching, structured output) |
| `src/lambda/lib/contentSchema.js` | JSON schema constraining each idea |
| `src/lambda/lib/store.js` | Queue persistence (swap for a real backend in prod) |
| `src/lambda/lib/assemble.js` | Hands off to an ffmpeg render worker (stubbed) |
| `src/lambda/lib/publishers.js` | Instagram Graph API + TikTok draft upload |
| `src/ReviewDashboard.js` | React review UI |

## Run locally

```sh
cp .env.example .env      # fill in ANTHROPIC_API_KEY at minimum
yarn install
yarn start:lambda         # serves functions at /.netlify/functions/*
yarn start                # CRA dev server (render <ReviewDashboard/> from App.js)
```

Generate a batch, then review:

```sh
curl -X POST localhost:9000/generate-content -d '{"niche":"home espresso for beginners","count":4}'
curl localhost:9000/queue?status=pending
```

(Ports depend on your `netlify-lambda` / `netlify dev` setup.)

## Scheduling (3–4×/day on autopilot)

Run **generation** a few times a day so the queue stays full, and **publish**
a few times a day to drain approved items. Two options:

- **Netlify Scheduled Functions** — add a `schedule` export / `netlify.toml`
  `[functions."generate-content"] schedule = "0 9,15,21 * * *"`.
- **EventBridge / cron** hitting the function URLs.

Generation and publishing are decoupled on purpose: ideas pile up for review,
and only what *you* approved ever goes out.

## Platform reality (read before going live)

- **Instagram Reels** — publishable via the Graph API, but only for
  **Business/Creator** accounts linked to a Facebook Page, and the MP4 must be
  hosted at a **public HTTPS URL** first. `publishers.js` does the 3-step
  container → poll → publish flow.
- **TikTok** — unaudited apps can only push to the **draft inbox**; you tap
  "post" in the app. Public auto-posting requires TikTok's app-audit approval.
  We push drafts, which is ToS-compliant and what unaudited apps can do today.
- **Account health** — platforms flag high-volume, low-effort automated posting.
  The approval gate (plus varied, genuinely useful content) is what keeps this
  from looking like spam. Don't remove it to "go fully hands-off."

## What's stubbed

**Video assembly** (`lib/assemble.js`) is the one piece that can't run inside a
lightweight function — TTS + visuals + caption burn-in + ffmpeg need a real
worker (container, Cloud Run/Fargate, or a CI job) and public object storage for
the result. The stub calls `RENDER_WORKER_URL` if set, or returns
`PLACEHOLDER_VIDEO_URL` so you can exercise approve → publish end-to-end first.

## Production checklist

- [ ] Replace the file store in `lib/store.js` with Netlify Blobs / DynamoDB / Supabase.
- [ ] Build the render worker and set `RENDER_WORKER_URL`; host output publicly.
- [ ] Add OAuth + token refresh for IG and TikTok (tokens expire).
- [ ] Add auth to the dashboard + functions (they're open in this scaffold).
- [ ] Schedule generate + publish; monitor `failed` items.
