from __future__ import annotations

import json
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Callable, Literal

from . import captions, ingest, render, score, transcribe

Progress = Callable[[str, float], None]


@dataclass
class ClipResult:
    index: int
    start_sec: float
    end_sec: float
    duration_sec: float
    hook: str
    caption: str
    hashtags: list[str]
    score: float
    reason: str
    video_path: str
    caption_path: str


@dataclass
class PipelineResult:
    job_id: str
    source_title: str
    source_uploader: str
    source_url: str
    output_dir: str
    clips: list[ClipResult]


def run(
    youtube_url: str,
    job_id: str,
    work_root: Path,
    output_root: Path,
    n_clips: int = 5,
    min_sec: int = 20,
    max_sec: int = 75,
    whisper_backend: Literal["local", "api"] = "local",
    whisper_model: str = "small.en",
    progress: Progress | None = None,
) -> PipelineResult:
    def emit(stage: str, pct: float) -> None:
        if progress:
            progress(stage, pct)

    work_dir = work_root / job_id
    out_dir = output_root / job_id
    out_dir.mkdir(parents=True, exist_ok=True)

    emit("downloading", 0.05)
    source = ingest.download(youtube_url, work_dir)

    emit("transcribing", 0.20)
    tx = transcribe.transcribe(
        source.video_path, backend=whisper_backend, model_size=whisper_model
    )
    (work_dir / "transcript.json").write_text(json.dumps(tx.to_dict(), indent=2))

    emit("scoring", 0.55)
    candidates = score.score_transcript(
        tx, n_clips=n_clips, min_sec=min_sec, max_sec=max_sec
    )

    clips: list[ClipResult] = []
    total = max(1, len(candidates))
    for i, cand in enumerate(candidates, start=1):
        emit(f"rendering clip {i}/{total}", 0.60 + 0.35 * (i / total))

        ass_path = work_dir / f"clip_{i:02d}.ass"
        ass_path.write_text(
            captions.build_karaoke_ass(tx, cand.start_sec, cand.end_sec)
        )

        video_path = out_dir / f"clip_{i:02d}.mp4"
        render.render_clip(
            source.video_path, ass_path, cand.start_sec, cand.end_sec, video_path
        )

        caption_text = cand.caption + "\n\n" + " ".join(f"#{h}" for h in cand.hashtags)
        caption_path = out_dir / f"clip_{i:02d}.txt"
        caption_path.write_text(caption_text)

        clips.append(
            ClipResult(
                index=i,
                start_sec=cand.start_sec,
                end_sec=cand.end_sec,
                duration_sec=cand.duration_sec,
                hook=cand.hook,
                caption=cand.caption,
                hashtags=cand.hashtags,
                score=cand.score,
                reason=cand.reason,
                video_path=str(video_path),
                caption_path=str(caption_path),
            )
        )

    result = PipelineResult(
        job_id=job_id,
        source_title=source.title,
        source_uploader=source.uploader,
        source_url=youtube_url,
        output_dir=str(out_dir),
        clips=clips,
    )
    (out_dir / "manifest.json").write_text(
        json.dumps(asdict(result), indent=2)
    )

    emit("done", 1.0)
    return result
