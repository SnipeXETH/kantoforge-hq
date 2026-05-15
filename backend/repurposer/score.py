from __future__ import annotations

import json
import re
from dataclasses import dataclass

import anthropic

from .transcribe import Transcript, to_scoring_text

MODEL = "claude-opus-4-7"

SYSTEM_PROMPT = """You are a short-form video editor who has produced thousands of viral podcast clips for TikTok, Instagram Reels, and YouTube Shorts.

You will receive a transcript of a podcast episode with timestamps like [MM:SS-MM:SS] at the start of each segment.

Your job: identify the strongest standalone clip candidates. A great clip:
- Has a hook in the first 3 seconds (a surprising claim, question, or vivid moment)
- Stands alone without needing context from the rest of the episode
- Has a clear arc: setup -> insight/punchline/payoff
- Lands on a satisfying beat (not mid-sentence)
- Provokes a reaction: surprise, disagreement, "wait what", laughter, a strong opinion
- Is 20-75 seconds long

Avoid: throat-clearing intros, plugs, tangents that need the surrounding 5 minutes to make sense, generic advice with no specifics.

For each clip, output:
- start_sec, end_sec: integer seconds, snapped to natural sentence boundaries from the transcript
- hook: the literal first line of the clip (verbatim from transcript)
- caption: a punchy social caption (≤180 chars) that teases the clip without spoiling the payoff. No hashtags inside the caption.
- hashtags: 3-6 relevant hashtags as an array of strings (no # prefix)
- score: 1-10, how clippable this moment is
- reason: one sentence on why this clips well

Return ONLY a JSON object: {"clips": [...]}. No prose, no markdown fences."""

USER_TEMPLATE = """Find the {n} strongest clip candidates from this transcript. Each clip should be {min_sec}-{max_sec} seconds.

TRANSCRIPT:
{transcript}"""


@dataclass
class ClipCandidate:
    start_sec: float
    end_sec: float
    hook: str
    caption: str
    hashtags: list[str]
    score: float
    reason: str

    @property
    def duration_sec(self) -> float:
        return self.end_sec - self.start_sec


def score_transcript(
    transcript: Transcript,
    n_clips: int = 5,
    min_sec: int = 20,
    max_sec: int = 75,
) -> list[ClipCandidate]:
    client = anthropic.Anthropic()
    transcript_text = to_scoring_text(transcript)

    user_msg = USER_TEMPLATE.format(
        n=n_clips, min_sec=min_sec, max_sec=max_sec, transcript=transcript_text
    )

    response = client.messages.create(
        model=MODEL,
        max_tokens=16000,
        thinking={"type": "adaptive"},
        output_config={"effort": "high"},
        system=[
            {
                "type": "text",
                "text": SYSTEM_PROMPT,
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": user_msg,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
            }
        ],
    )

    text = next((b.text for b in response.content if b.type == "text"), "")
    data = _parse_json(text)

    return [
        ClipCandidate(
            start_sec=float(c["start_sec"]),
            end_sec=float(c["end_sec"]),
            hook=c["hook"],
            caption=c["caption"],
            hashtags=list(c.get("hashtags") or []),
            score=float(c.get("score", 5)),
            reason=c.get("reason", ""),
        )
        for c in data.get("clips", [])
    ]


def _parse_json(text: str) -> dict:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(?:json)?\s*", "", text)
        text = re.sub(r"\s*```$", "", text)
    return json.loads(text)
