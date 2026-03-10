const axios = require("axios");
const { URL } = require("url");

/* ═══════════════════════════════════════════════════════════════
   SOURCE BASES
═══════════════════════════════════════════════════════════════ */
const MDX    = "https://api.mangadex.org";
const COMICK = "https://api.comick.io";
const MSEE   = "https://mangasee123.com";
const MKK    = "https://www.mangakakalot.gg";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

const api  = axios.create({ timeout: 5000 });
const imgs = axios.create({ timeout: 8000 });

/* ═══════════════════════════════════════════════════════════════
   IN-MEMORY CACHE
═══════════════════════════════════════════════════════════════ */
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.exp) { cache.delete(key); return null; }
  return entry.val;
}

function cacheSet(key, val, ttlMs) {
  if (cache.size >= 200) {
    const oldest = [...cache.entries()].sort((a, b) => a[1].exp - b[1].exp)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  cache.set(key, { val, exp: Date.now() + ttlMs });
}

const inflight = new Map();

async function withCache(key, ttlMs, fn) {
  const hit = cacheGet(key);
  if (hit !== null) return hit;
  if (inflight.has(key)) return inflight.get(key);
  const promise = fn().then(val => {
    if (val !== null && val !== undefined) cacheSet(key, val, ttlMs);
    inflight.delete(key);
    return val;
  }).catch(e => { inflight.delete(key); throw e; }); // FIX: rethrow instead of swallowing errors
  inflight.set(key, promise);
  return promise;
}

/* ── CORS ─────────────────────────────────────────────────────── */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
}

/* ═══════════════════════════════════════════════════════════════
   API HELPERS
═══════════════════════════════════════════════════════════════ */

async function mdx(path) {
  try {
    const r = await api.get(MDX + path, { headers: { "User-Agent": "MangaProxy/4.0" } });
    return r.data;
  } catch (e) {
    console.error("MDX", e?.response?.status, path.slice(0, 60));
    return null;
  }
}

async function comick(path) {
  try {
    const r = await api.get(COMICK + path, {
      headers: { "User-Agent": BROWSER_UA, "Referer": "https://comick.fun/" },
    });
    return r.data;
  } catch (e) {
    console.error("CK", e?.response?.status, path.slice(0, 60));
    return null;
  }
}

async function mseeGet(path) {
  try {
    const r = await api.get(MSEE + path, {
      headers: { "User-Agent": BROWSER_UA, "Referer": MSEE, "Accept": "text/html,*/*" },
    });
    return r.data;
  } catch (e) {
    console.error("MSEE", e?.response?.status, path.slice(0, 60));
    return null;
  }
}

async function mkkGet(path, referer) {
  try {
    const r = await api.get(MKK + path, {
      headers: { "User-Agent": BROWSER_UA, "Referer": referer || MKK, "Accept": "text/html,*/*" },
    });
    return r.data;
  } catch (e) {
    console.error("MKK", e?.response?.status, path.slice(0, 60));
    return null;
  }
}

/* ═══════════════════════════════════════════════════════════════
   MANGASEE HELPERS
═══════════════════════════════════════════════════════════════ */
function mseeDecodeChapter(encoded) {
  const s = String(encoded);
  const num = parseInt(s.slice(1, -1), 10);
  const dec = parseInt(s.slice(-1), 10);
  return dec ? `${num}.${dec}` : String(num);
}

function mseeImgUrl(pathName, slug, chapterEncoded, page) {
  const s = String(chapterEncoded);
  const main = s.slice(1, -1);
  const dec  = s.slice(-1);
  const chStr = dec !== "0" ? `${parseInt(main,10)}.${dec}` : String(parseInt(main,10)).padStart(4,"0");
  return `https://${pathName}/manga/${slug}/${chStr}-${String(page).padStart(3,"0")}.png`;
}

function mseeExtractVar(html, varName) {
  try {
    const m = html.match(new RegExp(`${varName}\\s*=\\s*"([^"]+)"`));
    return m ? m[1] : null;
  } catch { return null; }
}

function mseeExtractObj(html, varName) {
  try {
    const m = html.match(new RegExp(`${varName}\\s*=\\s*(\\{[^;]+\\});`));
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
}

function mseeExtractArr(html, varName) {
  try {
    const m = html.match(new RegExp(`${varName}\\s*=\\s*(\\[[\\s\\S]*?\\]);`));
    return m ? JSON.parse(m[1]) : null;
  } catch { return null; }
}

async function getMseeCatalogue() {
  return withCache("msee:cat", 30 * 60 * 1000, async () => {
    const html = await mseeGet("/search/");
    if (!html) return [];
    const m = html.match(/vm\.Directory\s*=\s*(\[[\s\S]*?\]);/);
    return m ? JSON.parse(m[1]) : [];
  });
}

/* ═══════════════════════════════════════════════════════════════
   MANGAKAKALOT HELPERS
═══════════════════════════════════════════════════════════════ */
function mkkImages(html) {
  const imgs = [];
  const re = /(?:img-loading|chapter-img)[^>]*src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) imgs.push(m[1]);
  if (imgs.length) return imgs;
  const block = html.match(/container-chapter-reader([\s\S]*?)(?:container-chapter-report|<footer)/);
  if (block) {
    const re2 = /src="(https:\/\/[^"]+\.(?:jpg|png|webp|jpeg))"/g;
    let m2;
    while ((m2 = re2.exec(block[1])) !== null) imgs.push(m2[1]);
  }
  return imgs;
}

function mkkChapters(html) {
  const re = /href="\/chapter\/([^"]+)"[^>]*>\s*(Chapter[^<]+)</gi;
  const chapters = [], seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const cid = m[1].trim();
    if (!seen.has(cid)) { seen.add(cid); chapters.push({ id: "mkk:" + cid, name: m[2].trim(), date: "", lang: "en" }); }
  }
  return chapters;
}

function mkkMangaInfo(html) {
  const title = (html.match(/<h1[^>]*>([^<]+)<\/h1>/) || [])[1]?.trim() || null;
  if (!title) return null;
  const image = (html.match(/class="[^"]*manga-info-pic[^"]*"[\s\S]*?src="([^"]+)"/) ||
                 html.match(/og:image[^>]+content="([^"]+)"/) || [])[1] || "";
  const desc  = (html.match(/id="noidungm"[^>]*>([\s\S]*?)<\/p>/) || [])[1]
                ?.replace(/<[^>]+>/g, "").trim().substring(0, 300) || "";
  const status = (html.match(/Status\s*:[\s\S]*?<a[^>]*>([^<]+)</) || [])[1]?.trim().toLowerCase() || "";
  const genreBlock = (html.match(/Genres[\s\S]{0,200}?<\/li>([\s\S]*?)<\/li>/) || [])[1] || "";
  const genres = [...genreBlock.matchAll(/href="[^"]*">([^<]+)<\/a>/g)].map(m => m[1].trim());
  return { title, image, description: desc, status, genres, source: "Mangakakalot" };
}

/* ═══════════════════════════════════════════════════════════════
   FORMATTERS
═══════════════════════════════════════════════════════════════ */
function dedup(list) {
  const seen = new Map();
  return list.filter(m => {
    const key = (m.title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

function fmt(m) {
  if (!m) return null;
  const a = m.attributes || {};
  const title = a.title ? (a.title.en || a.title["ja-ro"] || a.title.ja || Object.values(a.title)[0] || "Unknown") : "Unknown";
  const desc  = a.description ? (a.description.en || Object.values(a.description)[0] || "") : "";
  const cover = (m.relationships || []).find(r => r.type === "cover_art");
  const image = cover?.attributes?.fileName
    ? `https://uploads.mangadex.org/covers/${m.id}/${cover.attributes.fileName}.256.jpg` : "";
  const genres = (a.tags || [])
    .filter(t => t.attributes?.group === "genre" || t.attributes?.group === "theme")
    .map(t => t.attributes?.name?.en).filter(Boolean).slice(0, 6);
  return {
    id: "mdx:" + m.id, title, image, description: desc.substring(0, 300),
    status: a.status || "", genres, latestChapter: a.lastChapter || "",
    source: "MangaDex", demographic: a.publicationDemographic || "", year: a.year || "",
  };
}

function fmtCk(m) {
  if (!m) return null;
  const md = m.md_comics || m;
  const title = md.title || md.slug || "Unknown";
  const image = md.cover_url || (md.md_covers?.[0] && `https://meo.comick.pictures/${md.md_covers[0].b2key}`) || "";
  const genres = (md.md_comic_md_genres || []).map(g => g.md_genres?.name).filter(Boolean);
  return {
    id: "ck:" + (md.hid || md.slug), title, image,
    description: (md.desc || md.summary || "").substring(0, 300),
    status: md.status === 1 ? "ongoing" : md.status === 2 ? "completed" : "",
    genres, latestChapter: md.last_chapter ? String(md.last_chapter) : "",
    source: "ComicK", demographic: "", year: "",
  };
}

function fmtMsee(m) {
  if (!m) return null;
  const slug  = m.i || m.IndexName || "";
  const title = m.s || m.SeriesName || slug;
  const image = slug ? `https://temp.compsci88.com/cover/${slug}.jpg` : "";
  return {
    id: "msee:" + slug, title, image, description: "",
    status: (m.ss || "").toLowerCase().includes("complete") ? "completed" : "ongoing",
    genres: (m.g || []).map(g => typeof g === "object" ? g.v : g).filter(Boolean),
    latestChapter: "", source: "MangaSee", demographic: "", year: "",
  };
}

/* ── Tag UUIDs ─────────────────────────────────────────────────── */
const TAGS = {
  "action":"391b0423-d847-456f-aff0-8b0cfc03066b","adventure":"87cc87cd-a395-47af-b27a-93258283bbc6",
  "comedy":"4d32cc48-9f00-4cca-9b5a-a839f0764984","drama":"b9af3a63-f058-46de-a9a0-e0c13906197a",
  "fantasy":"cdc58593-87dd-415e-bbc0-2ec27bf404cc","romance":"423e2eae-a7a2-4a8b-ac03-a8351462d71d",
  "horror":"cdad7e68-1419-41dd-bdce-27753074a640","mystery":"ee968100-4191-4968-93d3-f82d72be7e46",
  "sci-fi":"256c8bd9-4904-4360-bf4f-508a76d67183","slice-of-life":"e5301a23-ebd9-49dd-a0cb-2add944c7fe9",
  "sports":"69964a64-2f90-4d33-beeb-e3d1177d9f0b","supernatural":"eabc5b4c-6aff-42f3-b657-3e90cbd00b75",
  "thriller":"07251805-a27e-4d59-b488-f0bfbec15168","martial-arts":"799c202e-7daa-44eb-9cf7-8a3c0441531e",
  "historical":"33771934-028e-4cb3-8744-691e866a923e","school-life":"caaa44eb-cd40-4177-b930-79d3ef2efa74",
  "ecchi":"b29d6a3d-1569-4e7a-8caf-7557bc92cd5d","mecha":"50880a9d-5440-4732-9afb-8f457127e836",
  "psychological":"3b60b75c-a2d7-4860-ab56-05f391bb889c","isekai":"ace04997-f6bd-436e-b261-779182193d3d",
  "magic":"a1f53773-c69a-4ce5-8cab-fffcd90b1565","harem":"aafb99c1-7f60-43fa-b75f-fc9502ce29c7",
  "monsters":"36fd93ea-e8b8-445e-b836-358f02b3d33d","survival":"5fff9cde-849c-4d78-aab0-0d52b2ee1d25",
  "time-travel":"292e862b-2d17-4062-90a2-0356caa4ae27",
  "yuri":        "a3c67850-4684-404e-9b7f-c69850ee5da6",
  "yaoi":        "320831a8-4026-470b-94f6-8353740e6f04",
  "music":       "f42fbf9e-188a-46cb-a301-21c36a9006b6",
  "medical":     "c8cbe35b-1b2b-4a3f-9c37-db84c4514331",
};
const DEMOGRAPHICS = { "shounen":"shounen","shoujo":"shoujo","seinen":"seinen","josei":"josei" };

function listQ(offset, extra) {
  return `/manga?limit=20&offset=${offset}&order[followedCount]=desc&includes[]=cover_art`
    + `&contentRating[]=safe&contentRating[]=suggestive` + (extra || "");
}


/* ── ComicK genre slugs ───────────────────────────────────────── */
const CK_GENRES = {
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

/* ═══════════════════════════════════════════════════════════════
   MAIN HANDLER
═══════════════════════════════════════════════════════════════ */
module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const parsed = new URL(req.url || "/", "http://localhost");
  const url    = parsed.pathname;
  const p      = Object.fromEntries(parsed.searchParams.entries());

  try {

    /* ── ROOT ───────────────────────────────────────────────────── */
    if (url === "/") return res.json({ status: "ok", sources: ["MangaDex", "ComicK", "MangaSee", "Mangakakalot"], cacheSize: cache.size });

    /* ── LIST — ComicK primary ─────────────────────────────────── */
    if (url === "/list" || url.startsWith("/list")) {
      const page  = Math.max(1, parseInt(p.page) || 1);
      const ckey  = `list:ck:${page}`;

      const result = await withCache(ckey, 5 * 60 * 1000, async () => {
        const ckData = await comick(`/top?page=${page}`);
        const mangas = dedup((ckData?.rank || []).map(fmtCk).filter(Boolean));
        return { mangas, currentPage: page, totalPages: 50, hasNextPage: page < 50 };
      }).catch(() => null);

      return res.json(result || { mangas: [], currentPage: page, totalPages: 1, hasNextPage: false });
    }

    /* ── SEARCH — ComicK primary ───────────────────────────────── */
    if (url.startsWith("/search")) {
      const q    = (p.q || "").trim();
      const page = Math.max(1, parseInt(p.page) || 1);
      if (!q) return res.json({ mangas: [], currentPage: 1, totalPages: 1, hasNextPage: false });
      const ckey = `search:ck:${q.toLowerCase()}:${page}`;

      const result = await withCache(ckey, 3 * 60 * 1000, async () => {
        // ComicK search is fast, comprehensive, and works reliably
        const ckData = await comick(`/v1.0/search?q=${encodeURIComponent(q)}&limit=20&page=${page}`);
        const mangas = dedup((Array.isArray(ckData) ? ckData : []).map(fmtCk).filter(Boolean));
        return { mangas, currentPage: page, totalPages: mangas.length === 20 ? page + 1 : page, hasNextPage: mangas.length === 20 };
      }).catch(() => null);

      return res.json(result || { mangas: [], currentPage: page, totalPages: 1, hasNextPage: false });
    }

    /* ── GENRE ──────────────────────────────────────────────────── */
    if (url.startsWith("/genre")) {
      const genre  = (p.genre || "action").toLowerCase();
      const page   = Math.max(1, parseInt(p.page) || 1);
      const offset = (page - 1) * 20;
      const ckey   = `genre:${genre}:${page}`;

      const result = await withCache(ckey, 5 * 60 * 1000, async () => {
        // ComicK genre browsing — uses their genre slug API
        const ckSlug = CK_GENRES[genre];
        let mangas = [];
        if (ckSlug) {
          // ComicK top comics filtered by genre
          const ckData = await comick(`/top?page=${page}&genre=${encodeURIComponent(ckSlug)}`);
          mangas = dedup((ckData?.rank || []).map(fmtCk).filter(Boolean));
        }
        // If ComicK genre didn't return results, fall back to MDX for that genre
        if (!mangas.length) {
          const ADULT_GENRES = new Set(["hentai","ecchi","yuri","yaoi","adult-action","nsfw-romance"]);
          let extra = "";
          let contentRatings = "&contentRating[]=safe&contentRating[]=suggestive";
          if (ADULT_GENRES.has(genre)) contentRatings += "&contentRating[]=erotica&contentRating[]=pornographic";
          if (DEMOGRAPHICS[genre]) extra = `&publicationDemographic[]=${DEMOGRAPHICS[genre]}`;
          else if (TAGS[genre])    extra = `&includedTags[]=${TAGS[genre]}`;
          const mdxData = await mdx(`/manga?limit=20&offset=${(page-1)*20}&order[followedCount]=desc&includes[]=cover_art${contentRatings}${extra}`);
          mangas = ((mdxData?.data || []).map(fmt).filter(Boolean));
        }
        return { mangas, currentPage: page, totalPages: 50, hasNextPage: page < 50 };
      }).catch(() => null);

      return res.json(result || { mangas: [], currentPage: page, totalPages: 1, hasNextPage: false });
    }

    /* ── MANGA DETAIL ───────────────────────────────────────────── */
    if (url.startsWith("/manga/")) {
      const rawId = decodeURIComponent(url.replace("/manga/", ""));
      const lang  = p.lang || "en";
      const ckey  = `manga:${rawId}:${lang}`;

      const result = await withCache(ckey, 10 * 60 * 1000, async () => {

        /* ComicK */
        if (rawId.startsWith("ck:")) {
          const hid = rawId.replace("ck:", "");
          const [comicData, chapData] = await Promise.all([
            comick(`/comic/${hid}`),
            comick(`/comic/${hid}/chapters?lang=${lang}&limit=500&page=1`),
          ]);
          const base = fmtCk(comicData && (comicData.comic || comicData));
          if (!base) return null;
          const chapters = ((chapData?.chapters) || []).map(c => ({
            id: "ck:" + c.hid, name: "Chapter " + (c.chap || "?"),
            date: c.created_at?.split("T")[0] || "", lang,
          }));
          return { ...base, chapters, chapterPages: 1 };
        }

        /* MangaSee */
        if (rawId.startsWith("msee:")) {
          const slug = rawId.replace("msee:", "");
          const html = await mseeGet(`/manga/${slug}`);
          if (!html) return null;
          const chapList = mseeExtractArr(html, "vm\\.Chapters");
          const title    = (html.match(/<h1>([^<]+)<\/h1>/) || html.match(/<title>([^<]+)<\/title>/) || [])[1]
                            ?.replace(/ - MangaSee.*/, "").trim() || slug;
          const image    = (html.match(/property="og:image"[^>]*content="([^"]+)"/) || [])[1]
                            || `https://temp.compsci88.com/cover/${slug}.jpg`;
          const desc     = (html.match(/property="og:description"[^>]*content="([^"]+)"/) || [])[1]?.substring(0, 300) || "";
          const chapters = (chapList || []).reverse().map(c => {
            const num = mseeDecodeChapter(c.Chapter);
            return { id: `msee:${slug}:${c.Chapter}`, name: `Chapter ${num}`, date: c.Date?.split(" ")[0] || "", lang: "en" };
          });
          return { id: rawId, title, image, description: desc, status: "", genres: [], source: "MangaSee", latestChapter: chapters.at(-1)?.name || "", chapters, chapterPages: 1 };
        }

        /* Mangakakalot */
        if (rawId.startsWith("mkk:")) {
          const mangaId = rawId.replace("mkk:", "");
          const html = await mkkGet(`/manga/${mangaId}`);
          if (!html) return null;
          const info = mkkMangaInfo(html);
          if (!info) return null;
          const chapters = mkkChapters(html).reverse();
          return { id: rawId, ...info, latestChapter: chapters.at(-1)?.name || "", chapters, chapterPages: 1 };
        }

        /* MangaDex — fetch metadata from MDX, but use ComicK for chapter IDs
           so that chapter images load reliably (MDX CDN blocks Vercel IPs).
           Strategy:
             1. Get manga info + title from MDX (cover, description, genres etc.)
             2. Search ComicK for this title → get ComicK chapter list (ck: IDs)
             3. If ComicK has chapters → return ck: chapter IDs (guaranteed to work)
             4. If ComicK doesn't have it → fall back to mdx: chapter IDs          */
        const id = rawId.replace(/^mdx:/, "");

        // Step 1: fetch MDX manga metadata
        const mangaData = await mdx(`/manga/${id}?includes[]=cover_art`);
        const base = fmt(mangaData?.data);
        if (!base) return null;

        // Step 2: try to find this manga on ComicK by title
        async function fetchCkChapters(title) {
          try {
            const titleLow = title.toLowerCase().replace(/[^a-z0-9]/g, "");
            const results  = await comick(`/v1.0/search?q=${encodeURIComponent(title)}&limit=5`);
            if (!Array.isArray(results) || !results.length) return null;
            // Pick best title match
            const match = results.find(m => {
              const t = (m.title || m.slug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
              return t === titleLow || t.includes(titleLow) || titleLow.includes(t);
            }) || results[0];
            const hid = match?.hid || match?.md_comics?.hid;
            if (!hid) return null;
            // Fetch chapters — try requested lang first, fall back to english
            const ckChaps = await comick(`/comic/${hid}/chapters?lang=${lang}&limit=500&page=1`);
            let chapters  = ckChaps?.chapters || [];
            if (!chapters.length && lang !== "en") {
              const ckEn  = await comick(`/comic/${hid}/chapters?lang=en&limit=500&page=1`);
              chapters    = ckEn?.chapters || [];
            }
            if (!chapters.length) return null;
            return chapters
              .sort((a, b) => (parseFloat(a.chap) || 0) - (parseFloat(b.chap) || 0))
              .reverse()
              .map(c => ({
                id:   "ck:" + c.hid,
                name: "Chapter " + (c.chap || "?"),
                date: c.created_at?.split("T")[0] || "",
                lang: c.lang || lang,
              }));
          } catch (e) {
            console.warn("CK chapter lookup failed:", e.message);
            return null;
          }
        }

        // Step 3: try ComicK chapters first
        const ckChapters = await fetchCkChapters(base.title);
        if (ckChapters && ckChapters.length) {
          return { ...base, chapters: ckChapters, chapterPages: 1, chapterSource: "ComicK" };
        }

        // Step 4: ComicK didn't have it — fall back to MDX chapter IDs
        console.log(`ComicK miss for "${base.title}", falling back to MDX chapters`);
        async function fetchMdxChaps(langFilter) {
          const first = await mdx(`/manga/${id}/feed?limit=500&offset=0&order[chapter]=desc${langFilter}`);
          if (!first?.data) return [];
          let all = [...first.data];
          if ((first.total || 0) > 500) {
            const r2 = await mdx(`/manga/${id}/feed?limit=500&offset=500&order[chapter]=desc${langFilter}`);
            if (r2?.data) all = all.concat(r2.data);
          }
          return all;
        }
        const rawChapters = await fetchMdxChaps(`&translatedLanguage[]=${lang}`);
        const seen = new Map();
        rawChapters.forEach(c => {
          const chLang = c.attributes.translatedLanguage || "";
          if (chLang !== lang) return;
          const key = `${chLang}:::${c.attributes.chapter || "?"}`;
          if (!seen.has(key)) seen.set(key, c);
        });
        const chapters = Array.from(seen.values())
          .sort((a, b) => (parseFloat(b.attributes.chapter) || 0) - (parseFloat(a.attributes.chapter) || 0))
          .map(c => ({
            id:   "mdx:" + c.id,
            name: "Chapter " + (c.attributes.chapter || "?"),
            date: c.attributes.publishAt?.split("T")[0] || "",
            lang: c.attributes.translatedLanguage || "",
          }));

        return { ...base, chapters, chapterPages: 1 };
      }).catch(() => null);

      if (!result) return res.status(404).json({ error: "Manga not found" });
      return res.json(result);
    }

    /* ── CHAPTER ────────────────────────────────────────────────── */
    if (url.startsWith("/chapter/")) {
      const raw  = decodeURIComponent(url.replace("/chapter/", ""));
      const ckey = `chapter:${raw}`;

      // Guard against missing / null IDs
      if (!raw || raw === "undefined" || raw === "null") {
        return res.status(400).json({
          error: "Missing chapter ID",
          hint: "Pass a chapter ID from the chapters list (e.g. mdx:<uuid>), not a manga ID.",
        });
      }

      let result;
      try {
        result = await withCache(ckey, 10 * 60 * 1000, async () => {

          /* ComicK */
          if (raw.startsWith("ck:")) {
            const id   = raw.replace("ck:", "");
            const data = await comick(`/chapter/${id}`);
            if (!data) return null;
            const imgList = (data.chapter?.md_images || data.chapter?.images || data.images || []);
            if (!imgList.length) return null;
            return imgList.map((img, i) => {
              const key = typeof img === "string" ? img : (img.b2key || img.name || "");
              return { img: `https://meo.comick.pictures/${key}`, page: i + 1 };
            }).filter(x => x.img !== "https://meo.comick.pictures/");
          }

          /* MangaSee */
          if (raw.startsWith("msee:")) {
            const parts    = raw.split(":");
            const slug     = parts[1];
            const chEnc    = parts[2];
            const chNum    = mseeDecodeChapter(chEnc);
            const html     = await mseeGet(`/read-online/${slug}-chapter-${chNum}.html`);
            if (!html) return null;
            const pathName = mseeExtractVar(html, "vm\\.CurPathName");
            const curChap  = mseeExtractObj(html, "vm\\.CurChapter");
            const pages    = parseInt(curChap?.Page || "0", 10);
            if (!pathName || !pages) return null;
            const refEnc = encodeURIComponent(`${MSEE}/read-online/${slug}-chapter-${chNum}.html`);
            return Array.from({ length: pages }, (_, i) => ({
              img:  `/img?url=${encodeURIComponent(mseeImgUrl(pathName, slug, chEnc, i + 1))}&ref=${refEnc}`,
              page: i + 1,
            }));
          }

          /* Mangakakalot */
          if (raw.startsWith("mkk:")) {
            const chapterId = raw.replace("mkk:", "");
            const mangaSlug = chapterId.split("/")[0];
            const html = await mkkGet(`/chapter/${chapterId}`, `${MKK}/manga/${mangaSlug}`);
            if (!html) return null;
            const imgUrls = mkkImages(html);
            if (!imgUrls.length) return null;
            return imgUrls.map((imgUrl, i) => ({
              img:  `/img?url=${encodeURIComponent(imgUrl)}&ref=${encodeURIComponent(MKK)}`,
              page: i + 1,
            }));
          }

          /* MangaDex */
          const id = raw.replace(/^mdx:/, "");

          // Validate UUID format — catches manga IDs being passed by mistake
          const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
          if (!UUID_RE.test(id)) {
            throw new Error(`Invalid chapter ID: "${id}". Expected a UUID chapter ID from the chapters list.`);
          }

          // Helper: fetch pages from ComicK as a fallback when MDX fails.
          // Looks up the chapter number + manga title from MDX metadata, then
          // searches ComicK for a matching chapter.
          async function tryComickFallback(mdxChapterId) {
            try {
              console.log(`Trying ComicK fallback for MDX chapter ${mdxChapterId}`);
              // Get chapter metadata from MDX (title, chapter number, manga relationship)
              const meta = await mdx(`/chapter/${mdxChapterId}?includes[]=manga`);
              if (!meta?.data) return null;

              const chNum  = meta.data.attributes?.chapter;
              const lang   = meta.data.attributes?.translatedLanguage || "en";
              const mangaRel = (meta.data.relationships || []).find(r => r.type === "manga");
              const mangaId  = mangaRel?.id;
              if (!chNum || !mangaId) return null;

              // Get the manga title to search ComicK
              const mangaMeta = await mdx(`/manga/${mangaId}?includes[]=cover_art`);
              const titleObj  = mangaMeta?.data?.attributes?.title || {};
              const title     = titleObj.en || titleObj["ja-ro"] || Object.values(titleObj)[0];
              if (!title) return null;

              // Search ComicK for this manga
              const ckSearch = await comick(`/v1.0/search?q=${encodeURIComponent(title)}&limit=5`);
              if (!Array.isArray(ckSearch) || !ckSearch.length) return null;

              // Pick the best match (first result whose title closely matches)
              const titleLow = title.toLowerCase().replace(/[^a-z0-9]/g, "");
              const ckManga  = ckSearch.find(m => {
                const t = (m.title || m.slug || "").toLowerCase().replace(/[^a-z0-9]/g, "");
                return t === titleLow || t.includes(titleLow) || titleLow.includes(t);
              }) || ckSearch[0];

              const ckHid = ckManga?.hid || ckManga?.md_comics?.hid;
              if (!ckHid) return null;

              // Get chapters from ComicK for this manga
              const ckChaps = await comick(`/comic/${ckHid}/chapters?lang=${lang}&limit=500&page=1`);
              const chapters = ckChaps?.chapters || [];

              // Find the chapter with matching number (exact first, then approximate)
              let match = chapters.find(c => String(c.chap) === String(chNum))
                       || chapters.find(c => parseFloat(c.chap) === parseFloat(chNum));
              if (!match) return null;

              // Fetch the ComicK chapter pages
              const ckData = await comick(`/chapter/${match.hid}`);
              if (!ckData) return null;
              const imgList = (ckData.chapter?.md_images || ckData.chapter?.images || ckData.images || []);
              if (!imgList.length) return null;

              console.log(`ComicK fallback succeeded for "${title}" ch.${chNum} (hid: ${match.hid})`);
              return imgList.map((img, i) => {
                const key = typeof img === "string" ? img : (img.b2key || img.name || "");
                return { img: `https://meo.comick.pictures/${key}`, page: i + 1, source: "ComicK (fallback)" };
              }).filter(x => x.img !== "https://meo.comick.pictures/");
            } catch (e) {
              console.warn("ComicK fallback failed:", e.message);
              return null;
            }
          }

          // First attempt at MDX at-home server
          let data = await mdx(`/at-home/server/${id}`);

          // Retry with 1s delay
          if (!data?.chapter) {
            console.warn(`MDX at-home miss for ${id}, retry 1 in 1s...`);
            await new Promise(r => setTimeout(r, 1000));
            data = await mdx(`/at-home/server/${id}`);
          }

          // Retry with 2s delay
          if (!data?.chapter) {
            console.warn(`MDX at-home miss for ${id}, retry 2 in 2s...`);
            await new Promise(r => setTimeout(r, 2000));
            data = await mdx(`/at-home/server/${id}`);
          }

          // All MDX attempts failed — try ComicK as fallback
          if (!data?.chapter) {
            console.warn(`MDX exhausted for ${id}, attempting ComicK fallback...`);
            const fallbackPages = await tryComickFallback(id);
            if (fallbackPages && fallbackPages.length) return fallbackPages;
            throw new Error(`Chapter unavailable on MangaDex and ComicK fallback also failed. The chapter may have been removed by the publisher.`);
          }

          const baseUrl    = data.baseUrl;
          const hash       = data.chapter.hash;
          const fullFiles  = data.chapter.data || [];
          const saverFiles = data.chapter.dataSaver || [];
          const useFiles   = fullFiles.length ? fullFiles : saverFiles;
          const usePath    = fullFiles.length ? "data" : "data-saver";

          if (!useFiles.length) {
            // No files from MDX — also try ComicK fallback
            console.warn(`MDX chapter ${id} has no image files, trying ComicK fallback...`);
            const fallbackPages = await tryComickFallback(id);
            if (fallbackPages && fallbackPages.length) return fallbackPages;
            throw new Error(`Chapter "${id}" has no image files on MangaDex and ComicK fallback failed.`);
          }

          // Return DIRECT CDN URLs — do NOT proxy through /img for MangaDex.
          // Vercel shared IPs get rate-limited by MangaDex; the browser fetches
          // directly without that issue. MangaDex CDN allows cross-origin requests.
          return useFiles.map((f, i) => {
            const direct = `${baseUrl}/${usePath}/${hash}/${f}`;
            const saver  = saverFiles[i] && usePath === "data"
              ? `${baseUrl}/data-saver/${hash}/${saverFiles[i]}`
              : (saverFiles[i] ? `${baseUrl}/data-saver/${hash}/${saverFiles[i]}` : null);
            return {
              img:      direct,           // direct CDN URL — browser fetches this
              fallback: saver || null,    // data-saver as fallback
              page:     i + 1,
              direct:   true,             // flag: frontend should NOT prepend API base
            };
          });
        });
      } catch (e) {
        console.error("Chapter fetch error:", e.message);
        // FIX: Use 404 for "not found" cases — 500 was misleading
        const isNotFound = e.message?.toLowerCase().includes("no data")
          || e.message?.toLowerCase().includes("removed")
          || e.message?.toLowerCase().includes("invalid chapter");
        return res.status(isNotFound ? 404 : 500).json({
          error: e.message || "Chapter not found or unavailable",
          id: raw,
          hint: "Make sure you are passing a chapter ID (from the chapters list), not a manga ID.",
        });
      }

      if (!result) {
        return res.status(404).json({
          error: "Chapter not found or unavailable",
          id: raw,
          hint: "The chapter may have been removed, or a manga ID was passed instead of a chapter ID.",
        });
      }
      return res.json(result);
    }

    /* ── IMAGE PROXY ────────────────────────────────────────────── */
    if (url === "/img") {
      const imgUrl  = p.url;
      const referer = p.ref ? decodeURIComponent(p.ref) : "https://mangadex.org/";
      if (!imgUrl) return res.status(400).json({ error: "Missing url param" });

      const tryFetch = async (target) => {
        const r = await imgs.get(target, {
          responseType: "stream",
          headers: { "Referer": referer, "User-Agent": BROWSER_UA },
        });
        if (r.status === 404) throw new Error("404");
        return r;
      };

      const isMdx    = imgUrl.includes("mangadex");
      const fallback = isMdx
        ? imgUrl.replace(/https:\/\/[^/]+\/(data(?:-saver)?\/)/, "https://uploads.mangadex.org/$1")
        : null;

      let r;
      try {
        r = await tryFetch(imgUrl);
      } catch (e) {
        if (fallback) {
          try { r = await tryFetch(fallback); } catch { return res.status(502).json({ error: "Image fetch failed" }); }
        } else {
          return res.status(502).json({ error: "Image fetch failed" });
        }
      }

      res.setHeader("Content-Type", r.headers["content-type"] || "image/jpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Access-Control-Allow-Origin", "*");
      r.data.pipe(res);
      return;
    }

    return res.status(404).json({ error: "Not found" });

  } catch (e) {
    console.error("Handler error", e.message);
    return res.status(500).json({ error: e.message });
  }
};
