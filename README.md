# Repurposer

Turns a YouTube podcast episode into vertical short-form clips with karaoke-style burned-in captions and AI-suggested social copy.

**Pipeline:** `yt-dlp` → `faster-whisper` (or OpenAI Whisper API) → Claude scores transcript for clippable moments → `ffmpeg` cuts, reframes to 9:16, burns word-by-word captions.

No auto-posting — the tool renders clips and suggested captions to a folder. You post.

## Layout

```
backend/           Python: pipeline + FastAPI server + CLI
  repurposer/
    ingest.py     yt-dlp download
    transcribe.py faster-whisper + OpenAI Whisper API
    score.py      Claude clip scoring (claude-opus-4-7)
    captions.py   karaoke ASS subtitles from word timings
    render.py     ffmpeg cut + 9:16 reframe + caption burn-in
    pipeline.py   orchestrator
    cli.py        `repurpose` command
    server.py     FastAPI: POST /api/jobs, GET /api/jobs/{id}
frontend/          Vite + React + TS UI
output/            Rendered clip_NN.mp4 + clip_NN.txt (captions)
work/              Intermediate downloads, transcripts (gitignored)
```

## Setup

System requirements: Python 3.10+, Node 18+, `ffmpeg` on PATH.

```sh
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e .

# Frontend
cd ../frontend
npm install
```

Environment:
```sh
export ANTHROPIC_API_KEY=sk-ant-...
# Optional, only if using --whisper api
export OPENAI_API_KEY=sk-...
```

## Run — CLI

```sh
cd backend
source .venv/bin/activate
repurpose 'https://www.youtube.com/watch?v=...' -n 5 --min 30 --max 60
```

Flags:
- `-n, --clips N` — number of clips (default 5)
- `--min S`, `--max S` — clip duration bounds in seconds (default 20–75)
- `--whisper local|api` — transcription backend (default local)
- `--model` — faster-whisper model: `tiny.en`, `base.en`, `small.en` (default), `medium.en`, `large-v3`
- `-o, --out DIR` — output directory (default `./output`)

Output: `output/<job-id>/clip_01.mp4`, `clip_01.txt`, ..., `manifest.json`.

## Run — Web UI

In two terminals:

```sh
# Backend
cd backend && source .venv/bin/activate
repurpose-server   # serves on :8000

# Frontend
cd frontend && npm run dev   # serves on :5173, proxies /api -> :8000
```

Open http://localhost:5173. Paste a YouTube URL, pick clip count and duration, hit Generate. Progress updates live; finished clips render in cards with copy-caption and download buttons.

For a single-process deploy: `npm run build` in `frontend/`, then `repurpose-server` will auto-mount `frontend/dist/` at `/`.

## Notes

- **Transcription is the slow step.** `small.en` on CPU takes roughly 0.3× wall time of the source. For long episodes, use a GPU machine or switch to the API.
- **Cost.** Claude Opus 4.7 scoring runs once per episode against the full transcript — typically a few cents per hour of audio. OpenAI Whisper API is $0.006/min if you use it.
- **Quality knobs.** If the model picks weak clips, try (a) more candidates with `-n 10` and pick from those, or (b) tighten the `min`/`max` range to match your platform's sweet spot.
- **Caption font.** The ASS template uses Montserrat with a black outline. If your system doesn't have it, ffmpeg falls back to a default sans — install Montserrat for the intended look.
