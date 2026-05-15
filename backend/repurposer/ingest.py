from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import yt_dlp


@dataclass
class Source:
    video_path: Path
    title: str
    duration_sec: float
    uploader: str
    video_id: str


def download(url: str, work_dir: Path) -> Source:
    work_dir.mkdir(parents=True, exist_ok=True)
    outtmpl = str(work_dir / "%(id)s.%(ext)s")

    opts = {
        "format": "bv*[height<=1080]+ba/b[height<=1080]",
        "merge_output_format": "mp4",
        "outtmpl": outtmpl,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "writeinfojson": False,
    }

    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)

    video_id = info["id"]
    video_path = work_dir / f"{video_id}.mp4"
    if not video_path.exists():
        for candidate in work_dir.glob(f"{video_id}.*"):
            if candidate.suffix in {".mp4", ".mkv", ".webm"}:
                video_path = candidate
                break

    return Source(
        video_path=video_path,
        title=info.get("title", "Untitled"),
        duration_sec=float(info.get("duration", 0) or 0),
        uploader=info.get("uploader", ""),
        video_id=video_id,
    )
