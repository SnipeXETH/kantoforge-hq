from __future__ import annotations

import uuid
from pathlib import Path

import click

from .pipeline import run


@click.command()
@click.argument("youtube_url")
@click.option("-n", "--clips", "n_clips", default=5, show_default=True, type=int)
@click.option("--min", "min_sec", default=20, show_default=True, type=int)
@click.option("--max", "max_sec", default=75, show_default=True, type=int)
@click.option(
    "--whisper",
    "whisper_backend",
    type=click.Choice(["local", "api"]),
    default="local",
    show_default=True,
    help="local = faster-whisper, api = OpenAI Whisper API",
)
@click.option(
    "--model",
    "whisper_model",
    default="small.en",
    show_default=True,
    help="faster-whisper model (tiny.en, base.en, small.en, medium.en, large-v3)",
)
@click.option(
    "-o",
    "--out",
    "output_dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("./output"),
    show_default=True,
)
@click.option(
    "--work",
    "work_dir",
    type=click.Path(file_okay=False, path_type=Path),
    default=Path("./work"),
    show_default=True,
)
def main(
    youtube_url: str,
    n_clips: int,
    min_sec: int,
    max_sec: int,
    whisper_backend: str,
    whisper_model: str,
    output_dir: Path,
    work_dir: Path,
) -> None:
    """Repurpose a YouTube podcast episode into short vertical clips."""
    job_id = uuid.uuid4().hex[:8]
    click.echo(f"Job {job_id}")

    def progress(stage: str, pct: float) -> None:
        click.echo(f"  [{pct*100:5.1f}%] {stage}")

    result = run(
        youtube_url=youtube_url,
        job_id=job_id,
        work_root=work_dir,
        output_root=output_dir,
        n_clips=n_clips,
        min_sec=min_sec,
        max_sec=max_sec,
        whisper_backend=whisper_backend,  # type: ignore[arg-type]
        whisper_model=whisper_model,
        progress=progress,
    )

    click.echo(f"\nSource: {result.source_title} ({result.source_uploader})")
    click.echo(f"Output: {result.output_dir}\n")
    for clip in result.clips:
        click.echo(
            f"  #{clip.index}  {clip.start_sec:6.1f}-{clip.end_sec:6.1f}s  "
            f"score={clip.score:.1f}  {clip.hook[:60]}"
        )


if __name__ == "__main__":
    main()
