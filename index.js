const axios = require("axios");
const { URL } = require("url");

const COMICK    = "https://api.comick.io";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const api = axios.create({ timeout: 10000 });

/* ── Cache ── */
const cache = new Map();
function cacheGet(k) {
  const e = cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { cache.delete(k); return null; }
  return e.val;
}
function cacheSet(k, v, ttl) {
  if (cache.size >= 300) {
    const old = [...cache.entries()].sort((a,b) => a[1].exp - b[1].exp)[0];
    if (old) cache.delete(old[0]);
  }
  cache.set(k, { val: v, exp: Date.now() + ttl });
}
const inflight = new Map();
async function withCache(k, ttl, fn) {
  const hit = cacheGet(k);
  if (hit !== null) return hit;
  if (inflight.has(k)) return inflight.get(k);
  const p = fn().then(v => {
    if (v != null) cacheSet(k, v, ttl);
    inflight.delete(k);
    return v;
  }).catch(e => { inflight.delete(k); throw e; });
  inflight.set(k, p);
  return p;
}

/* ── ComicK fetch ── */
async function ck(path) {
  try {
    const r = await api.get(COMICK + path, {
      headers: { "User-Agent": BROWSER_UA, "Referer": "https://comick.fun/" }
    });
    return r.data;
  } catch(e) {
    console.error("CK", e?.response?.status, path.slice(0, 80));
    return null;
  }
}

/* ── Normalise a ComicK comic object into our standard shape ──
   ComicK returns different shapes depending on endpoint:
   - /top         → { rank: [ { md_comics: {...}, ...}, ... ] }  (each item has md_comics)
   - /v1.0/search → [ { title, hid, cover_url, ... }, ... ]      (flat)
   - /comic/:hid  → { comic: { title, hid, ... } }               (nested under comic)
*/
function fmt(raw) {
  if (!raw) return null;
  // Unwrap md_comics wrapper (from /top)
  const m = raw.md_comics || raw;
  if (!m) return null;

  const title = m.title || m.slug || "";
  if (!title) return null;

  // Cover image — try multiple fields
  let image = m.cover_url || "";
  if (!image && m.md_covers && m.md_covers.length) {
    image = `https://meo.comick.pictures/${m.md_covers[0].b2key}`;
  }
  if (!image && raw.cover_url) image = raw.cover_url;

  const genres = (m.md_comic_md_genres || [])
    .map(g => g.md_genres?.name).filter(Boolean);

  const status = m.status === 1 ? "ongoing"
               : m.status === 2 ? "completed" : "";

  const hid = m.hid || m.slug || "";
  if (!hid) return null;

  return {
    id:            "ck:" + hid,
    title,
    image,
    description:   (m.desc || m.summary || "").substring(0, 300),
    status,
    genres,
    latestChapter: m.last_chapter ? "Chapter " + m.last_chapter : "",
    source:        "ComicK",
    demographic:   "",
    year:          m.year || "",
  };
}

function dedup(list) {
  const seen = new Set();
  return list.filter(m => {
    const k = (m.title || "").toLowerCase().replace(/[^a-z0-9]/g,"");
    if (!k || seen.has(k)) return false;
    seen.add(k); return true;
  });
}

/* ── CORS ── */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
}

/* ── ComicK genre slugs ── */
const CK_GENRE = {
  "action":"action","adventure":"adventure","comedy":"comedy","drama":"drama",
  "fantasy":"fantasy","romance":"romance","horror":"horror","mystery":"mystery",
  "sci-fi":"sci-fi","slice-of-life":"slice-of-life","sports":"sports",
  "supernatural":"supernatural","thriller":"thriller","martial-arts":"martial-arts",
  "historical":"historical","school-life":"school-life","ecchi":"ecchi",
  "mecha":"mecha","psychological":"psychological","isekai":"isekai",
  "magic":"magic","harem":"harem","monsters":"monster","survival":"survival",
  "time-travel":"time-travel","music":"music","medical":"medical",
  "shounen":"shounen","shoujo":"shoujo","seinen":"seinen","josei":"josei",
  "yuri":"yuri","yaoi":"yaoi","cooking":"cooking","villainess":"villainess",
};

/* ════════════════════════════════════════════════════════════════
   MAIN HANDLER
════════════════════════════════════════════════════════════════ */
module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const parsed = new URL(req.url || "/", "http://localhost");
  const url    = parsed.pathname;
  const p      = Object.fromEntries(parsed.searchParams.entries());

  try {

    /* ── ROOT ── */
    if (url === "/") return res.json({ status: "ok", source: "ComicK", cacheSize: cache.size });

    /* ── LIST ── */
    if (url === "/list" || url.startsWith("/list")) {
      const page = Math.max(1, parseInt(p.page) || 1);
      const result = await withCache(`list:${page}`, 5*60*1000, async () => {
        const data = await ck(`/top?page=${page}`);
        // /top returns { rank: [...] } where each item has md_comics
        const items  = data?.rank || data || [];
        const mangas = dedup(items.map(fmt).filter(Boolean));
        return { mangas, currentPage: page, totalPages: 50, hasNextPage: page < 50 };
      }).catch(() => null);
      return res.json(result || { mangas: [], currentPage: page, totalPages: 1, hasNextPage: false });
    }

    /* ── SEARCH ── */
    if (url.startsWith("/search")) {
      const q    = (p.q || "").trim();
      const page = Math.max(1, parseInt(p.page) || 1);
      if (!q) return res.json({ mangas: [], currentPage: 1, totalPages: 1, hasNextPage: false });
      const result = await withCache(`search:${q.toLowerCase()}:${page}`, 3*60*1000, async () => {
        // /v1.0/search returns a flat array
        const data   = await ck(`/v1.0/search?q=${encodeURIComponent(q)}&limit=20&page=${page}`);
        const items  = Array.isArray(data) ? data : (data?.results || []);
        const mangas = dedup(items.map(fmt).filter(Boolean));
        return {
          mangas,
          currentPage: page,
          totalPages:  mangas.length === 20 ? page + 1 : page,
          hasNextPage: mangas.length === 20,
        };
      }).catch(() => null);
      return res.json(result || { mangas: [], currentPage: page, totalPages: 1, hasNextPage: false });
    }

    /* ── GENRE ── */
    if (url.startsWith("/genre")) {
      const genre = (p.genre || "").toLowerCase();
      const page  = Math.max(1, parseInt(p.page) || 1);
      const slug  = CK_GENRE[genre];
      const result = await withCache(`genre:${genre}:${page}`, 5*60*1000, async () => {
        // Use search with genre tag — more reliable than /top?genre=
        let items = [];
        if (slug) {
          const data = await ck(`/v1.0/search?page=${page}&limit=20&genre=${encodeURIComponent(slug)}&sort=follow`);
          items = Array.isArray(data) ? data : (data?.results || []);
        }
        // Fallback to top list if genre search returns nothing
        if (!items.length) {
          const data = await ck(`/top?page=${page}`);
          items = data?.rank || [];
        }
        const mangas = dedup(items.map(fmt).filter(Boolean));
        return { mangas, currentPage: page, totalPages: 50, hasNextPage: page < 50 };
      }).catch(() => null);
      return res.json(result || { mangas: [], currentPage: page, totalPages: 1, hasNextPage: false });
    }

    /* ── MANGA DETAIL ── */
    if (url.startsWith("/manga/")) {
      const rawId = decodeURIComponent(url.replace("/manga/", ""));
      const lang  = p.lang || "en";
      const hid   = rawId.replace(/^ck:/, "");
      const result = await withCache(`manga:${hid}:${lang}`, 10*60*1000, async () => {
        const [comicData, chapData] = await Promise.all([
          ck(`/comic/${hid}`),
          ck(`/comic/${hid}/chapters?lang=${lang}&limit=500&page=1`),
        ]);
        // /comic/:hid returns { comic: {...}, ... }
        const base = fmt(comicData?.comic || comicData);
        if (!base) return null;

        let chapters = (chapData?.chapters || []).map(c => ({
          id:   "ck:" + c.hid,
          name: "Chapter " + (c.chap || "?"),
          date: c.created_at?.split("T")[0] || "",
          lang: c.lang || lang,
        }));

        // Fallback to English if no chapters in requested lang
        if (!chapters.length && lang !== "en") {
          const enData = await ck(`/comic/${hid}/chapters?lang=en&limit=500&page=1`);
          chapters = (enData?.chapters || []).map(c => ({
            id:   "ck:" + c.hid,
            name: "Chapter " + (c.chap || "?"),
            date: c.created_at?.split("T")[0] || "",
            lang: c.lang || "en",
          }));
        }

        return { ...base, chapters, chapterPages: 1 };
      }).catch(() => null);

      if (!result) return res.status(404).json({ error: "Manga not found" });
      return res.json(result);
    }

    /* ── CHAPTER ── */
    if (url.startsWith("/chapter/")) {
      const raw = decodeURIComponent(url.replace("/chapter/", ""));
      if (!raw || raw === "undefined" || raw === "null") {
        return res.status(400).json({ error: "Missing chapter ID" });
      }
      const hid  = raw.replace(/^ck:/, "");
      const data = await ck(`/chapter/${hid}`);
      if (!data) return res.status(404).json({ error: "Chapter not found", id: raw });

      const imgList = data.chapter?.md_images
        || data.chapter?.images
        || data.images
        || [];

      if (!imgList.length) return res.status(404).json({ error: "Chapter has no images", id: raw });

      const pages = imgList.map((img, i) => {
        const key = typeof img === "string" ? img : (img.b2key || img.name || "");
        if (!key) return null;
        return { img: `https://meo.comick.pictures/${key}`, page: i + 1 };
      }).filter(Boolean);

      if (!pages.length) return res.status(404).json({ error: "Chapter has no images", id: raw });
      return res.json(pages);
    }

    return res.status(404).json({ error: "Not found" });

  } catch(e) {
    console.error("Handler error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};
