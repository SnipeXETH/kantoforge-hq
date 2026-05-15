from __future__ import annotations

import os
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Literal


@dataclass
class Word:
    start: float
    end: float
    text: str


@dataclass
class Segment:
    start: float
    end: float
    text: str
    words: list[Word]


@dataclass
class Transcript:
    language: str
    segments: list[Segment]

    def to_dict(self) -> dict:
        return {
            "language": self.language,
            "segments": [
                {
                    "start": s.start,
                    "end": s.end,
                    "text": s.text,
                    "words": [asdict(w) for w in s.words],
                }
                for s in self.segments
            ],
        }


def transcribe(
    audio_path: Path,
    backend: Literal["local", "api"] = "local",
    model_size: str = "small.en",
) -> Transcript:
    if backend == "api":
        return _transcribe_openai(audio_path)
    return _transcribe_faster_whisper(audio_path, model_size)


def _transcribe_faster_whisper(audio_path: Path, model_size: str) -> Transcript:
    from faster_whisper import WhisperModel

    model = WhisperModel(model_size, device="auto", compute_type="auto")
    segments_iter, info = model.transcribe(
        str(audio_path),
        word_timestamps=True,
        vad_filter=True,
    )

    segments: list[Segment] = []
    for seg in segments_iter:
        words = [
            Word(start=w.start, end=w.end, text=w.word.strip())
            for w in (seg.words or [])
            if w.start is not None and w.end is not None
        ]
        segments.append(
            Segment(start=seg.start, end=seg.end, text=seg.text.strip(), words=words)
        )

    return Transcript(language=info.language, segments=segments)


def _transcribe_openai(audio_path: Path) -> Transcript:
    from openai import OpenAI

    client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    with audio_path.open("rb") as f:
        result = client.audio.transcriptions.create(
            file=f,
            model="whisper-1",
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )

    word_objs = [
        Word(start=w.start, end=w.end, text=w.word.strip())
        for w in (result.words or [])
    ]

    segments: list[Segment] = []
    for seg in result.segments or []:
        seg_words = [w for w in word_objs if w.start >= seg.start and w.end <= seg.end]
        segments.append(
            Segment(start=seg.start, end=seg.end, text=seg.text.strip(), words=seg_words)
        )

    return Transcript(language=result.language or "en", segments=segments)


def to_scoring_text(transcript: Transcript) -> str:
    """Compact, timestamp-prefixed transcript for the LLM scorer."""
    lines = []
    for seg in transcript.segments:
        lines.append(f"[{_fmt(seg.start)}-{_fmt(seg.end)}] {seg.text}")
    return "\n".join(lines)


def _fmt(t: float) -> str:
    m, s = divmod(int(t), 60)
    return f"{m:02d}:{s:02d}"
