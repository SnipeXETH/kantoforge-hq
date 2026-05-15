from __future__ import annotations

import os
import threading
import traceback
import uuid
from dataclasses import asdict
from pathlib import Path
from typing import Literal

import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .pipeline import PipelineResult, run

OUTPUT_ROOT = Path(os.environ.get("REPURPOSE_OUTPUT_DIR", "./output")).resolve()
WORK_ROOT = Path(os.environ.get("REPURPOSE_WORK_DIR", "./work")).resolve()
FRONTEND_DIST = Path(os.environ.get("REPURPOSE_FRONTEND_DIST", "./frontend/dist")).resolve()

OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
WORK_ROOT.mkdir(parents=True, exist_ok=True)


class JobCreate(BaseModel):
    youtube_url: str
    n_clips: int = 5
    min_sec: int = 20
    max_sec: int = 75
    whisper_backend: Literal["local", "api"] = "local"
    whisper_model: str = "small.en"


class JobState(BaseModel):
    job_id: str
    status: Literal["queued", "running", "done", "error"]
    stage: str
    progress: float
    error: str | None = None
    result: dict | None = None


jobs: dict[str, JobState] = {}
jobs_lock = threading.Lock()

app = FastAPI(title="Repurposer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _update(job_id: str, **fields) -> None:
    with jobs_lock:
        current = jobs[job_id]
        jobs[job_id] = current.model_copy(update=fields)


def _run_job(job_id: str, req: JobCreate) -> None:
    _update(job_id, status="running", stage="starting", progress=0.0)

    def progress(stage: str, pct: float) -> None:
        _update(job_id, stage=stage, progress=pct)

    try:
        result: PipelineResult = run(
            youtube_url=req.youtube_url,
            job_id=job_id,
            work_root=WORK_ROOT,
            output_root=OUTPUT_ROOT,
            n_clips=req.n_clips,
            min_sec=req.min_sec,
            max_sec=req.max_sec,
            whisper_backend=req.whisper_backend,
            whisper_model=req.whisper_model,
            progress=progress,
        )
        _update(job_id, status="done", stage="done", progress=1.0, result=asdict(result))
    except Exception as e:
        _update(
            job_id,
            status="error",
            stage="error",
            error=f"{e}\n{traceback.format_exc()}",
        )


@app.post("/api/jobs", response_model=JobState)
def create_job(req: JobCreate) -> JobState:
    job_id = uuid.uuid4().hex[:8]
    state = JobState(job_id=job_id, status="queued", stage="queued", progress=0.0)
    with jobs_lock:
        jobs[job_id] = state
    threading.Thread(target=_run_job, args=(job_id, req), daemon=True).start()
    return state


@app.get("/api/jobs/{job_id}", response_model=JobState)
def get_job(job_id: str) -> JobState:
    with jobs_lock:
        state = jobs.get(job_id)
    if state is None:
        raise HTTPException(404, "job not found")
    return state


@app.get("/api/clips/{job_id}/{filename}")
def get_clip_file(job_id: str, filename: str):
    # Prevent path traversal
    if "/" in filename or ".." in filename or filename.startswith("."):
        raise HTTPException(400, "invalid filename")
    path = OUTPUT_ROOT / job_id / filename
    try:
        path.resolve().relative_to(OUTPUT_ROOT)
    except ValueError:
        raise HTTPException(400, "invalid path")
    if not path.is_file():
        raise HTTPException(404, "file not found")
    return FileResponse(path)


if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")


def main() -> None:
    uvicorn.run(
        "repurposer.server:app",
        host=os.environ.get("HOST", "127.0.0.1"),
        port=int(os.environ.get("PORT", "8000")),
        reload=False,
    )


if __name__ == "__main__":
    main()
