// JSON schema for a single short-form video idea, used to constrain Claude's
// output via `output_config.format` so every queue item is well-structured.
//
// Structured-output schemas can't use min/max length or numeric bounds — the
// SDK strips unsupported constraints — so keep validation in the prompt.

export const reelSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string", description: "Internal working title for this idea" },
    hook: {
      type: "string",
      description: "The first 1-2 lines / first 3 seconds. Must stop the scroll.",
    },
    script: {
      type: "array",
      description: "Voiceover broken into short beats, in spoken order",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          voiceover: { type: "string", description: "What is said in this beat" },
          on_screen_text: { type: "string", description: "Caption burned onto the frame" },
          visual: { type: "string", description: "What is shown (b-roll, stock query, AI prompt)" },
        },
        required: ["voiceover", "on_screen_text", "visual"],
      },
    },
    cta: { type: "string", description: "Call to action for the final beat" },
    caption: { type: "string", description: "Post caption (platform-agnostic)" },
    hashtags: {
      type: "array",
      description: "5-12 hashtags, no leading #",
      items: { type: "string" },
    },
    suggested_audio: {
      type: "string",
      description: "Trending-audio direction or music mood, not a specific copyrighted track",
    },
    estimated_seconds: { type: "integer", description: "Target runtime, 15-45" },
  },
  required: [
    "title",
    "hook",
    "script",
    "cta",
    "caption",
    "hashtags",
    "suggested_audio",
    "estimated_seconds",
  ],
}

export const batchSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    ideas: { type: "array", items: reelSchema },
  },
  required: ["ideas"],
}
