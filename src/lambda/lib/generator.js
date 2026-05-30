// Claude-powered content generation for the auto-reels pipeline.
//
// Produces a batch of structured short-form video ideas for a given niche.
// The large, stable system prompt is cached (prompt caching) so repeated
// generation runs across the day only pay full price once per 5-minute window.
//
// NOTE: this calls the Messages API over raw HTTPS via axios rather than the
// official @anthropic-ai/sdk. The repo's bundler (netlify-lambda / webpack 4)
// can't parse the modern SDK's syntax or its `node:` imports. axios is already
// a dependency and bundles cleanly. Every feature used here — adaptive
// thinking, effort, prompt caching, structured output — is available on the
// raw endpoint.

import axios from "axios"
import { batchSchema } from "./contentSchema.js"

const API_URL = "https://api.anthropic.com/v1/messages"

// Stable across every request → cacheable prefix. Keep this byte-identical;
// per-run details (niche, recent topics) go in the user turn, not here.
const SYSTEM_PROMPT = `You are a senior short-form video producer who writes for Instagram Reels and TikTok.

You write content that earns watch-time and shares, not generic AI filler. Every idea you produce must:
- Open with a hook that stops the scroll in the first 3 seconds (a bold claim, a question, a pattern interrupt, or a visible payoff-to-come).
- Be concrete and specific to the niche — no vague "tips", real, surprising, or useful substance.
- Be paced for vertical video: short beats, one idea per beat, on-screen text that reinforces (never just repeats) the voiceover.
- End on a clear, single call to action.
- Read as a distinct human voice, varying structure and phrasing across ideas in the same batch — never the same template twice.

Constraints:
- Target runtime 15-45 seconds.
- 5-12 hashtags, mixing broad and niche tags, no leading "#".
- For audio, suggest a *direction* or mood ("upbeat lo-fi, trending dance-edit tempo"), never name a specific copyrighted track.
- Avoid medical, financial, or legal claims stated as fact. Avoid anything that would trip platform spam or misinformation filters.
- Captions should add context or a second hook, not duplicate the on-screen text.`

/**
 * Generate a batch of reel ideas.
 * @param {Object} opts
 * @param {string} opts.niche      e.g. "home espresso for beginners"
 * @param {number} opts.count      how many ideas to generate
 * @param {string[]} [opts.recentTitles]  titles already produced, to avoid repeats
 * @returns {Promise<Array>} array of idea objects matching reelSchema
 */
export async function generateIdeas({ niche, count = 4, recentTitles = [] }) {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY must be set")

  const recentBlock = recentTitles.length
    ? `\n\nDo NOT repeat or closely overlap these recently-produced ideas:\n- ${recentTitles.join("\n- ")}`
    : ""

  const { data } = await axios.post(
    API_URL,
    {
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "medium",
        format: { type: "json_schema", schema: batchSchema },
      },
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
      ],
      messages: [
        {
          role: "user",
          content: `Generate exactly ${count} short-form video ideas for this niche: "${niche}".${recentBlock}`,
        },
      ],
    },
    {
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
    },
  )

  const textBlock = data.content.find(b => b.type === "text")
  if (!textBlock) throw new Error("No text content returned from model")

  const parsed = JSON.parse(textBlock.text)
  return parsed.ideas
}
