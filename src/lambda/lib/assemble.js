// Video assembly — the one stage that does NOT belong in a lightweight
// Netlify Function.
//
// Turning a script into a 9:16 MP4 means: text-to-speech for the voiceover,
// sourcing visuals (stock API or AI video), burning on-screen captions, and
// stitching it all with ffmpeg. ffmpeg needs a real binary and CPU/time that a
// standard function invocation doesn't have.
//
// Run this on a worker that has ffmpeg available — a container (Fargate/Cloud
// Run), a GitHub Action, or a queue consumer — then upload the result to public
// object storage (S3/R2/Supabase Storage) and return the public HTTPS URL.
//
// This stub documents the contract and lets the rest of the pipeline run
// end-to-end against a placeholder until the real renderer is wired in.

/**
 * Produce a public HTTPS URL for the rendered 9:16 video.
 * @param {Object} item  a queue item (item.content has script/hook/etc.)
 * @returns {Promise<{ videoUrl: string }>}
 */
export async function assembleVideo(item) {
  if (process.env.RENDER_WORKER_URL) {
    // Real path: hand off to the ffmpeg worker and get back a hosted URL.
    const axios = (await import("axios")).default
    const { data } = await axios.post(process.env.RENDER_WORKER_URL, { item })
    return { videoUrl: data.videoUrl }
  }

  // Scaffold path: a placeholder so approve → publish can be exercised.
  // Set RENDER_WORKER_URL (or a fixed PLACEHOLDER_VIDEO_URL) to make this real.
  const placeholder = process.env.PLACEHOLDER_VIDEO_URL
  if (!placeholder) {
    throw new Error(
      "No renderer configured. Set RENDER_WORKER_URL (ffmpeg worker) or PLACEHOLDER_VIDEO_URL for testing.",
    )
  }
  return { videoUrl: placeholder }
}
