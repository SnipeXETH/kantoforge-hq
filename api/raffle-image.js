// Serves a public competition's prize image as a real PNG/JPEG URL (decoded
// from the inline data URL) so it can be used as an Open Graph image. Falls
// back to the logo. Only images for competitions marked public are served.

const { createClient } = require("@supabase/supabase-js");

module.exports = async (req, res) => {
  try {
    const id = req.query && req.query.id;
    const supaUrl = process.env.REACT_APP_SUPABASE_URL || process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (id && supaUrl && key) {
      const supa = createClient(supaUrl, key, { auth: { persistSession: false } });
      const { data } = await supa.from("competitions").select("data").eq("id", id).maybeSingle();
      const c = data && data.data;
      if (c && c.isPublic && c.prizeImage && c.prizeImage.indexOf("data:image") === 0) {
        const m = c.prizeImage.match(/^data:(image\/[\w+]+);base64,(.+)$/);
        if (m) {
          const buf = Buffer.from(m[2], "base64");
          res.setHeader("content-type", m[1]);
          res.setHeader("cache-control", "public, max-age=300");
          return res.status(200).send(buf);
        }
      }
    }
  } catch (e) {
    /* fall through to logo */
  }
  res.setHeader("location", "/brand/logo-light@2x.png");
  return res.status(302).end();
};
