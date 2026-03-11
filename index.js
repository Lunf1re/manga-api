// This Vercel API is no longer used for data fetching.
// All manga data is fetched via Cloudflare Worker → ComicK directly.
module.exports = (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.json({ status: "ok", note: "Use Cloudflare Worker for manga data" });
};
