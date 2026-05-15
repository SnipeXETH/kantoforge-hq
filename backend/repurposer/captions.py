from __future__ import annotations

from .transcribe import Transcript, Word

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,Montserrat,88,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,6,2,2,40,40,420,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

ACTIVE_COLOR = r"{\c&H0000FFFF&}"  # yellow (ASS uses BGR)
RESET_COLOR = r"{\c&H00FFFFFF&}"   # white


def words_in_range(transcript: Transcript, start: float, end: float) -> list[Word]:
    words: list[Word] = []
    for seg in transcript.segments:
        if seg.end < start or seg.start > end:
            continue
        for w in seg.words:
            if w.end >= start and w.start <= end:
                words.append(w)
    return words


def build_karaoke_ass(
    transcript: Transcript,
    clip_start: float,
    clip_end: float,
    group_size: int = 3,
) -> str:
    """Build ASS subtitles with karaoke-style word-by-word color highlighting.

    Words are grouped into chunks of `group_size`. Each chunk produces one event
    per word, covering the time from that word's start until the next word's
    start (or the chunk end). The active word is colored; the rest are white.
    Same font size throughout to avoid line reflow.
    """
    words = words_in_range(transcript, clip_start, clip_end)
    if not words:
        return ASS_HEADER

    events: list[str] = []
    chunks = [words[i : i + group_size] for i in range(0, len(words), group_size)]
    for ci, chunk in enumerate(chunks):
        chunk_end_abs = (
            chunks[ci + 1][0].start if ci + 1 < len(chunks) else chunk[-1].end
        )
        for j, active in enumerate(chunk):
            t0 = max(0.0, active.start - clip_start)
            next_start = chunk[j + 1].start if j + 1 < len(chunk) else chunk_end_abs
            t1 = max(t0 + 0.05, next_start - clip_start)
            parts: list[str] = []
            for k, w in enumerate(chunk):
                clean = _escape_ass(w.text)
                if k == j:
                    parts.append(ACTIVE_COLOR + clean + RESET_COLOR)
                else:
                    parts.append(clean)
            text = " ".join(parts)
            events.append(
                f"Dialogue: 0,{_ts(t0)},{_ts(t1)},Caption,,0,0,0,,{text}"
            )

    return ASS_HEADER + "\n".join(events) + "\n"


def _ts(t: float) -> str:
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = t % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _escape_ass(text: str) -> str:
    return text.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
