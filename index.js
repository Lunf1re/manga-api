const axios = require("axios");
const { URL } = require("url");

const COMICK   = "https://api.comick.io";
const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const api = axios.create({ timeout: 8000 });

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

/* ── ComicK API ── */
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

/* ── Formatter ── */
function fmt(m) {
  if (!m) return null;
  const md = m.md_comics || m;
  const title = md.title || md.slug || "Unknown";
  const image = md.cover_url
    || (md.md_covers?.[0] ? `https://meo.comick.pictures/${md.md_covers[0].b2key}` : "")
    || "";
  const genres = (md.md_comic_md_genres || []).map(g => g.md_genres?.name).filter(Boolean);
  const status = md.status === 1 ? "ongoing" : md.status === 2 ? "completed" : "";
  return {
    id:            "ck:" + (md.hid || md.slug),
    title,
    image,
    description:   (md.desc || md.summary || "").substring(0, 300),
    status,
    genres,
    latestChapter: md.last_chapter ? "Chapter " + md.last_chapter : "",
    source:        "ComicK",
    demographic:   "",
    year:          md.year || "",
  };
}

function dedup(list) {
  const seen = new Set();
  return list.filter(m => {
    const k = (m.title || "").toLowerCase().replace(/[^a-z0-9]/g,"");
    if (seen.has(k)) return false;
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
        const mangas = dedup((data?.rank || []).map(fmt).filter(Boolean));
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
        const data   = await ck(`/v1.0/search?q=${encodeURIComponent(q)}&limit=20&page=${page}`);
        const mangas = dedup((Array.isArray(data) ? data : []).map(fmt).filter(Boolean));
        return { mangas, currentPage: page, totalPages: mangas.length === 20 ? page+1 : page, hasNextPage: mangas.length === 20 };
      }).catch(() => null);
      return res.json(result || { mangas: [], currentPage: page, totalPages: 1, hasNextPage: false });
    }

    /* ── GENRE ── */
    if (url.startsWith("/genre")) {
      const genre = (p.genre || "").toLowerCase();
      const page  = Math.max(1, parseInt(p.page) || 1);
      const slug  = CK_GENRE[genre];
      const result = await withCache(`genre:${genre}:${page}`, 5*60*1000, async () => {
        const path = slug
          ? `/top?page=${page}&genre=${encodeURIComponent(slug)}`
          : `/top?page=${page}`;
        const data   = await ck(path);
        const mangas = dedup((data?.rank || []).map(fmt).filter(Boolean));
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
        const base = fmt(comicData?.comic || comicData);
        if (!base) return null;
        let chapters = (chapData?.chapters || []).map(c => ({
          id:   "ck:" + c.hid,
          name: "Chapter " + (c.chap || "?"),
          date: c.created_at?.split("T")[0] || "",
          lang: c.lang || lang,
        }));
        // If no chapters in requested lang, try English
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
      const hid = raw.replace(/^ck:/, "");
      const data = await ck(`/chapter/${hid}`);
      if (!data) return res.status(404).json({ error: "Chapter not found", id: raw });
      const imgList = data.chapter?.md_images || data.chapter?.images || data.images || [];
      if (!imgList.length) return res.status(404).json({ error: "Chapter has no images", id: raw });
      const pages = imgList.map((img, i) => {
        const key = typeof img === "string" ? img : (img.b2key || img.name || "");
        return { img: `https://meo.comick.pictures/${key}`, page: i + 1 };
      }).filter(x => x.img !== "https://meo.comick.pictures/");
      if (!pages.length) return res.status(404).json({ error: "Chapter has no images", id: raw });
      return res.json(pages);
    }

    return res.status(404).json({ error: "Not found" });

  } catch(e) {
    console.error("Handler error:", e.message);
    return res.status(500).json({ error: e.message });
  }
};
