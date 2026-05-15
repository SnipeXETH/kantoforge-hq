from __future__ import annotations

import shlex
import subprocess
from pathlib import Path


def render_clip(
    source_video: Path,
    ass_path: Path,
    start_sec: float,
    end_sec: float,
    out_path: Path,
) -> None:
    """Cut [start, end] from source, reframe to 9:16 with a blurred background,
    burn in karaoke captions from ass_path, and write H.264/AAC mp4 to out_path.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    duration = end_sec - start_sec

    # 9:16 vertical at 1080x1920:
    # - blurred, zoomed background fills the full frame
    # - the actual video sits in the middle, scaled to fit width preserving aspect
    # - karaoke captions burned in via ass filter
    ass_escaped = str(ass_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
    vf = (
        "split=2[bg][fg];"
        "[bg]scale=1080:1920:force_original_aspect_ratio=increase,"
        "crop=1080:1920,boxblur=luma_radius=40:luma_power=2[bgb];"
        "[fg]scale=1080:-2[fgs];"
        "[bgb][fgs]overlay=(W-w)/2:(H-h)/2:format=auto,"
        f"ass='{ass_escaped}'"
    )

    cmd = [
        "ffmpeg",
        "-y",
        "-ss", f"{start_sec:.3f}",
        "-i", str(source_video),
        "-t", f"{duration:.3f}",
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "20",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        str(out_path),
    ]

    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed (exit {proc.returncode}):\n"
            f"command: {' '.join(shlex.quote(c) for c in cmd)}\n"
            f"stderr: {proc.stderr[-2000:]}"
        )
