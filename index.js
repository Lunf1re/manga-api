/* ─────────────────────────────────────────────────────────────
   manga-api — pure CORS proxy for api.comick.fun
   Every request: /proxy?url=<encoded comick url>
   Also keeps friendly named routes for backwards compatibility.
───────────────────────────────────────────────────────────── */
const https  = require("https");
const http   = require("http");
const { URL } = require("url");

const CK = "api.comick.fun";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
}

/* Forward any path to ComicK and pipe response back */
function proxy(ckPath, res) {
  return new Promise((resolve) => {
    const options = {
      hostname: CK,
      path:     ckPath,
      method:   "GET",
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        "Accept":          "application/json, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer":         "https://comick.fun/",
        "Origin":          "https://comick.fun",
        "Connection":      "keep-alive",
      },
    };
    const req = https.request(options, (r) => {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.status(r.statusCode);
      r.pipe(res);
      r.on("end", resolve);
    });
    req.on("error", (e) => {
      res.status(502).json({ error: e.message });
      resolve();
    });
    req.setTimeout(12000, () => {
      req.destroy();
      res.status(504).json({ error: "timeout" });
      resolve();
    });
    req.end();
  });
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const parsed = new URL(req.url || "/", "http://localhost");
  const url    = parsed.pathname;
  const p      = Object.fromEntries(parsed.searchParams.entries());

  /* ── Root ── */
  if (url === "/") {
    return res.json({ status: "ok", proxy: CK });
  }

  /* ── Generic proxy: /proxy?path=/top?page=1 ── */
  if (url === "/proxy") {
    const ckPath = p.path || "/top?page=1";
    return proxy(ckPath, res);
  }

  /* ── Named routes — translate to ComicK paths ── */
  try {
    let ckPath = null;

    if (url === "/list" || url.startsWith("/list")) {
      const page = Math.max(1, parseInt(p.page) || 1);
      ckPath = `/top?page=${page}`;
    }
    else if (url.startsWith("/search")) {
      const q    = (p.q || "").trim();
      const page = Math.max(1, parseInt(p.page) || 1);
      if (!q) return res.json({ results: [] });
      ckPath = `/v1.0/search?q=${encodeURIComponent(q)}&limit=20&page=${page}`;
    }
    else if (url.startsWith("/genre")) {
      const genre = (p.genre || "").toLowerCase();
      const page  = Math.max(1, parseInt(p.page) || 1);
      const SLUGS = {
        "action":"action","adventure":"adventure","comedy":"comedy","drama":"drama",
        "fantasy":"fantasy","romance":"romance","horror":"horror","mystery":"mystery",
        "sci-fi":"sci-fi","slice-of-life":"slice-of-life","sports":"sports",
        "supernatural":"supernatural","thriller":"thriller","martial-arts":"martial-arts",
        "historical":"historical","school-life":"school-life","ecchi":"ecchi",
        "mecha":"mecha","psychological":"psychological","isekai":"isekai",
        "shounen":"shounen","shoujo":"shoujo","seinen":"seinen","josei":"josei",
        "yuri":"yuri","yaoi":"yaoi",
      };
      const slug = SLUGS[genre];
      ckPath = slug
        ? `/v1.0/search?page=${page}&limit=20&genre=${encodeURIComponent(slug)}&sort=follow`
        : `/top?page=${page}`;
    }
    else if (url.startsWith("/manga/")) {
      const rawId = decodeURIComponent(url.replace("/manga/", ""));
      const hid   = rawId.replace(/^ck:/, "");
      const lang  = p.lang || "en";
      // Return comic detail — client will call /chapters separately
      ckPath = `/comic/${hid}`;
    }
    else if (url.startsWith("/chapters/")) {
      const rawId = decodeURIComponent(url.replace("/chapters/", ""));
      const hid   = rawId.replace(/^ck:/, "");
      const lang  = p.lang || "en";
      ckPath = `/comic/${hid}/chapters?lang=${lang}&limit=500&page=1`;
    }
    else if (url.startsWith("/chapter/")) {
      const rawId = decodeURIComponent(url.replace("/chapter/", ""));
      const hid   = rawId.replace(/^ck:/, "");
      ckPath = `/chapter/${hid}`;
    }

    if (ckPath) return proxy(ckPath, res);

    return res.status(404).json({ error: "Not found" });

  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
