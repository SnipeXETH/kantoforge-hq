// Platform publishers.
//
// IMPORTANT — platform reality check (see PIPELINE.md):
//   Instagram: Reels can be published via the Graph API, but ONLY for
//     Business/Creator accounts linked to a Facebook Page, and the video must
//     already be hosted at a public HTTPS URL.
//   TikTok: Unaudited apps can only push to the user's DRAFT inbox — the user
//     taps "post" in the app. Direct public posting needs TikTok app-audit
//     approval. We push drafts here, which is the safe, ToS-compliant path.

import axios from "axios"

const GRAPH = "https://graph.facebook.com/v21.0"

const sleep = ms => new Promise(r => setTimeout(r, ms))

/**
 * Publish a Reel to Instagram.
 * @param {Object} p
 * @param {string} p.videoUrl   public HTTPS URL of the rendered 9:16 MP4
 * @param {string} p.caption    full caption incl. hashtags
 */
export async function publishInstagramReel({ videoUrl, caption }) {
  const igUserId = process.env.IG_USER_ID
  const token = process.env.IG_ACCESS_TOKEN
  if (!igUserId || !token) throw new Error("IG_USER_ID and IG_ACCESS_TOKEN must be set")

  // 1. Create the media container.
  const { data: container } = await axios.post(`${GRAPH}/${igUserId}/media`, null, {
    params: { media_type: "REELS", video_url: videoUrl, caption, access_token: token },
  })

  // 2. Poll until the container has finished processing.
  for (let i = 0; i < 30; i++) {
    const { data: status } = await axios.get(`${GRAPH}/${container.id}`, {
      params: { fields: "status_code", access_token: token },
    })
    if (status.status_code === "FINISHED") break
    if (status.status_code === "ERROR") throw new Error("Instagram media processing failed")
    await sleep(3000)
  }

  // 3. Publish the container.
  const { data: published } = await axios.post(`${GRAPH}/${igUserId}/media_publish`, null, {
    params: { creation_id: container.id, access_token: token },
  })

  return { platform: "instagram", id: published.id, mode: "published" }
}

/**
 * Push a video to the user's TikTok DRAFT inbox via the Content Posting API.
 * The user finishes captioning/posting inside the TikTok app.
 * @param {Object} p
 * @param {string} p.videoUrl   public HTTPS URL of the rendered MP4
 */
export async function pushTikTokDraft({ videoUrl }) {
  const token = process.env.TIKTOK_ACCESS_TOKEN
  if (!token) throw new Error("TIKTOK_ACCESS_TOKEN must be set")

  const { data } = await axios.post(
    "https://open.tiktokapis.com/v2/post/publish/inbox/video/init/",
    { source_info: { source: "PULL_FROM_URL", video_url: videoUrl } },
    { headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } },
  )

  return { platform: "tiktok", id: data.data && data.data.publish_id, mode: "draft" }
}
