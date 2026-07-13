#!/usr/bin/env python3
"""
KantoForge render agent — runs on your PC, turns portal jobs into Blender renders.

It polls Supabase for queued render jobs, writes the card + artwork the portal
sent to temp files, runs Blender headless with render_job.py to render your
.blend template, then uploads the finished PNG back to the job. Leave it running
(a terminal window) whenever you want to serve renders.

Setup: copy .env.example to .env, fill it in, then:  python kf_render_agent.py
Only Python 3.8+ is required — no pip packages needed.
"""
import os
import sys
import time
import json
import base64
import tempfile
import subprocess
import urllib.request
import urllib.error


def load_env():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env()


def need(name):
    v = os.environ.get(name)
    if not v:
        sys.exit("Missing required setting %s (set it in blender/.env)" % name)
    return v


SUPABASE_URL = need("SUPABASE_URL").rstrip("/")
SERVICE_KEY = need("SUPABASE_SERVICE_ROLE_KEY")
BLENDER = os.environ.get("BLENDER_PATH", "blender")
TEMPLATE = need("KF_TEMPLATE")
CARD_IMG_NAME = need("KF_CARD_IMG_NAME")
ART_IMG_NAME = need("KF_ART_IMG_NAME")
POLL = int(os.environ.get("KF_POLL_SECONDS", "5"))
SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "render_job.py")

HEADERS = {
    "apikey": SERVICE_KEY,
    "Authorization": "Bearer " + SERVICE_KEY,
    "Content-Type": "application/json",
}


def api(method, path, body=None, extra_headers=None):
    url = SUPABASE_URL + "/rest/v1/" + path
    data = json.dumps(body).encode() if body is not None else None
    headers = dict(HEADERS)
    if extra_headers:
        headers.update(extra_headers)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else []


def next_job():
    rows = api("GET", "render_jobs?status=eq.queued&select=id,card_image,art_image,params&order=created_at.asc&limit=1")
    return rows[0] if rows else None


def patch(job_id, body):
    body = dict(body)
    body["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    api("PATCH", "render_jobs?id=eq." + job_id, body, {"Prefer": "return=minimal"})


def write_dataurl(dataurl, path):
    b64 = dataurl.split(",", 1)[1]
    with open(path, "wb") as f:
        f.write(base64.b64decode(b64))


def render(job, workdir):
    card = os.path.join(workdir, "card.png")
    art = os.path.join(workdir, "art.png")
    out = os.path.join(workdir, "out.png")
    write_dataurl(job["card_image"], card)
    write_dataurl(job["art_image"], art)
    env = dict(os.environ)
    env.update({
        "KF_CARD_IMG_NAME": CARD_IMG_NAME,
        "KF_ART_IMG_NAME": ART_IMG_NAME,
        "KF_CARD_FILE": card,
        "KF_ART_FILE": art,
        "KF_OUTPUT": out,
    })
    params = job.get("params") or {}
    if params.get("resX"):
        env["KF_RES_X"] = str(params["resX"])
    if params.get("resY"):
        env["KF_RES_Y"] = str(params["resY"])
    proc = subprocess.run([BLENDER, "-b", TEMPLATE, "-P", SCRIPT], env=env, capture_output=True, text=True)
    if proc.returncode != 0 or "KF_RENDER_OK" not in (proc.stdout or "") or not os.path.exists(out):
        raise RuntimeError((proc.stderr or proc.stdout or "Blender render failed")[-1800:])
    with open(out, "rb") as f:
        return "data:image/png;base64," + base64.b64encode(f.read()).decode()


def main():
    print("KantoForge render agent — polling", SUPABASE_URL, "every", POLL, "s")
    print("Template:", TEMPLATE, "| Blender:", BLENDER)
    while True:
        job = None
        try:
            job = next_job()
            if not job:
                time.sleep(POLL)
                continue
            print("→ rendering job", job["id"])
            patch(job["id"], {"status": "rendering"})
            with tempfile.TemporaryDirectory() as wd:
                result = render(job, wd)
            patch(job["id"], {"status": "done", "result_image": result, "error": None})
            print("✓ done", job["id"])
        except urllib.error.URLError as e:
            print("network error:", e)
            time.sleep(POLL)
        except Exception as e:  # noqa
            print("✗ error:", e)
            if job:
                try:
                    patch(job["id"], {"status": "failed", "error": str(e)[:1800]})
                except Exception:
                    pass
            time.sleep(POLL)


if __name__ == "__main__":
    main()
