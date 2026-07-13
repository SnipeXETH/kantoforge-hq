# KantoForge render agent

Turns product-image jobs submitted in the portal (**Studio → Product images →
3D render**) into real Blender renders on your PC — full fidelity (screws,
glass, lighting), no render farm.

```
Portal (queue a job)  ──►  Supabase  ──►  this agent on your PC  ──►  Blender renders  ──►  result back to the portal
```

## One-time setup

1. **Run the database step** (once): Supabase → SQL Editor → run
   `supabase/migrations/2026-07-render-queue.sql`.

2. **Find your two image names.** Open your `.blend` in Blender. In the Outliner
   switch the mode dropdown (top-left of the Outliner) to **Blender File** and
   expand **Images** — note the datablock name for the **card** and for the
   **background artwork** (e.g. `card_placeholder.png`, `art_placeholder.png`).
   These are the images the agent will replace each render.

3. **Configure the agent.** In this `blender/` folder, copy `.env.example` to
   `.env` and fill in:
   - `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API —
     the **service_role** key; it's secret, keep it on your PC only)
   - `BLENDER_PATH` (only if `blender` isn't already on your PATH)
   - `KF_TEMPLATE` — full path to your `.blend`
   - `KF_CARD_IMG_NAME` / `KF_ART_IMG_NAME` — the two names from step 2

4. **Check Blender runs from a terminal:** `blender --version`. If not, set the
   full path in `BLENDER_PATH`.

## Running it

In this folder:

```
python kf_render_agent.py
```

Leave that window open. It prints a line each time it renders a job. Now, in the
portal, go to **Studio → Product images → 3D render (Blender)**, upload a card +
artwork, and press **Queue render** — the agent picks it up, renders, and the
finished image appears in the portal to download.

Only Python 3.8+ is needed — no `pip install` required.

## Tips

- Keep the render fast by staying in **Eevee** in your `.blend`.
- To render automatically whenever your PC is on, set the agent to run on login
  (Windows: Task Scheduler → "At log on"; macOS/Linux: a login item / systemd
  user service).
- The agent uses the service-role key, which bypasses database security — only
  run it on a machine you control, and never commit your `.env`.
- Set output resolution in the portal; it's passed to Blender per job.
