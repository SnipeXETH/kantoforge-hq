// File storage for large images (commission cards + finished artwork), so they
// live in Supabase Storage instead of inline in realtime-synced rows — that
// inline blob on the commissions table was what deadlocked writes.
import { supabase } from "./supabase";

export const BUCKET = "kf-assets";
export const MAX_UPLOAD = 50 * 1024 * 1024; // 50 MB per file

const mb = (n) => Math.round(n / (1024 * 1024));

function bucketMissing(msg) {
  return /bucket.*not.*found|not found|does not exist/i.test(msg || "");
}

// Upload an image File to the bucket and return its public URL.
export async function uploadImage(file, folder = "misc") {
  if (!file) throw new Error("No file chosen.");
  if (!file.type || !file.type.startsWith("image/")) throw new Error("Please choose an image file (PNG or JPG).");
  if (file.size > MAX_UPLOAD) throw new Error(`That file is ${mb(file.size)}MB — the limit is 50MB. Please use a smaller file.`);
  const ext = ((file.name || "").split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
  const path = `${folder.replace(/\/+$/, "")}/${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (error) {
    if (bucketMissing(error.message)) throw new Error("Image storage isn't set up yet — run the storage step in Supabase (supabase/migrations/2026-07-storage.sql).");
    throw new Error(error.message);
  }
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
}

// Turn any image source (a storage URL or an old inline data: URL) into a
// downscaled JPEG data URL — used to feed the render queue without shipping a
// 50MB blob into a render_jobs row. Goes via a blob so the canvas isn't
// cross-origin "tainted" and toDataURL is allowed.
export async function scaledDataUrl(src, maxDim = 2400, quality = 0.92) {
  if (!src) return src;
  const blob = await (await fetch(src)).blob();
  const bmp = await createImageBitmap(blob);
  let w = bmp.width, h = bmp.height;
  const longest = Math.max(w, h);
  if (longest > maxDim) { const s = maxDim / longest; w = Math.round(w * s); h = Math.round(h * s); }
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  return c.toDataURL("image/jpeg", quality);
}
