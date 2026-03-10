const axios = require("axios");
const { URL } = require("url");

const MDX    = "https://api.mangadex.org";
const COMICK = "https://api.comick.fun";
const http   = axios.create({ timeout: 9000 }); // Vercel Hobby = 10s max

/* ── CORS ────────────────────────────────────────────────────── */
function cors(res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
}

/* ── MDX helper ──────────────────────────────────────────────── */
async function mdx(path) {
  try {
    const r = await http.get(MDX + path, {
      headers: { "User-Agent": "MangaProxy/3.0" },
    });
    return r.data;
  } catch (e) {
    console.error("MDX error", path, e?.response?.status, e?.message);
    return null;
  }
}

/* ── MDX with retry (for at-home server) ────────────────────── */
async function mdxRetry(path, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const data = await mdx(path);
    if (data) return data;
    if (i < tries - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)));
  }
  return null;
}

/* ── ComicK helper ───────────────────────────────────────────── */
async function comick(path) {
  try {
    const r = await http.get(COMICK + path, {
      headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://comick.fun/" },
    });
    return r.data;
  } catch (e) {
    console.error("ComicK error", path, e?.response?.status, e?.message);
    return null;
  }
}

/* ── Deduplicate by normalized title ─────────────────────────── */
function dedup(list) {
  const seen = new Map();
  return list.filter(m => {
    const key = m.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
}

/* ── Format one manga object ─────────────────────────────────── */
function fmt(m) {
  if (!m) return null;
  const a = m.attributes || {};

  const title = a.title
    ? (a.title.en || a.title["ja-ro"] || a.title.ja || Object.values(a.title)[0] || "Unknown")
    : "Unknown";

  const desc = a.description
    ? (a.description.en || Object.values(a.description)[0] || "")
    : "";

  const cover = (m.relationships || []).find(r => r.type === "cover_art");
  const image = cover?.attributes?.fileName
    ? `https://uploads.mangadex.org/covers/${m.id}/${cover.attributes.fileName}.256.jpg`
    : "";

  const genres = (a.tags || [])
    .filter(t => t.attributes?.group === "genre" || t.attributes?.group === "theme")
    .map(t => t.attributes?.name?.en)
    .filter(Boolean).slice(0, 6);

  return {
    id:             "mdx:" + m.id,
    title,
    image,
    description:    desc.substring(0, 300),
    status:         a.status || "",
    genres,
    latestChapter:  a.lastChapter || "",
    source:         "MangaDex",
    demographic:    a.publicationDemographic || "",
    year:           a.year || "",
  };
}

/* ── Format ComicK manga ─────────────────────────────────────── */
function fmtCk(m) {
  if (!m) return null;
  const md = m.md_comics || m;
  const title = md.title || md.slug || "Unknown";
  const image = md.cover_url ||
    (md.md_covers && md.md_covers[0] && `https://meo.comick.pictures/${md.md_covers[0].b2key}`) || "";
  const genres = (md.md_comic_md_genres || [])
    .map(g => g.md_genres && g.md_genres.name).filter(Boolean);
  return {
    id:            "ck:" + (md.hid || md.slug),
    title,
    image,
    description:   (md.desc || md.summary || "").substring(0, 300),
    status:        md.status === 1 ? "ongoing" : md.status === 2 ? "completed" : "",
    genres,
    latestChapter: md.last_chapter ? String(md.last_chapter) : "",
    source:        "ComicK",
    demographic:   "",
    year:          "",
  };
}

/* ── Tag UUIDs (verified from MangaDex API) ──────────────────── */
const TAGS = {
  "action":          "391b0423-d847-456f-aff0-8b0cfc03066b",
  "adventure":       "87cc87cd-a395-47af-b27a-93258283bbc6",
  "comedy":          "4d32cc48-9f00-4cca-9b5a-a839f0764984",
  "drama":           "b9af3a63-f058-46de-a9a0-e0c13906197a",
  "fantasy":         "cdc58593-87dd-415e-bbc0-2ec27bf404cc",
  "romance":         "423e2eae-a7a2-4a8b-ac03-a8351462d71d",
  "horror":          "cdad7e68-1419-41dd-bdce-27753074a640",
  "mystery":         "ee968100-4191-4968-93d3-f82d72be7e46",
  "sci-fi":          "256c8bd9-4904-4360-bf4f-508a76d67183",
  "slice-of-life":   "e5301a23-ebd9-49dd-a0cb-2add944c7fe9",
  "sports":          "69964a64-2f90-4d33-beeb-e3d1177d9f0b",
  "supernatural":    "eabc5b4c-6aff-42f3-b657-3e90cbd00b75",
  "thriller":        "07251805-a27e-4d59-b488-f0bfbec15168",
  "martial-arts":    "799c202e-7daa-44eb-9cf7-8a3c0441531e",
  "historical":      "33771934-028e-4cb3-8744-691e866a923e",
  "school-life":     "caaa44eb-cd40-4177-b930-79d3ef2efa74",
  "ecchi":           "b29d6a3d-1569-4e7a-8caf-7557bc92cd5d",
  "mecha":           "50880a9d-5440-4732-9afb-8f457127e836",
  "psychological":   "3b60b75c-a2d7-4860-ab56-05f391bb889c",
  "isekai":          "ace04997-f6bd-436e-b261-779182193d3d",
  "magic":           "a1f53773-c69a-4ce5-8cab-fffcd90b1565",
  "harem":           "aafb99c1-7f60-43fa-b75f-fc9502ce29c7",
  "music":           "f42fbf9e-188a-46cb-a301-21c36a9006b6",
  "cooking":         "ea2bc92d-1c26-4930-9b7c-d5c0dc1b6869",
  "medical":         "c8cbe35b-1b2b-4a3f-9c37-db84c4514331",
  "villainess":      "9438db5a-7e2a-4ac0-b39e-e0d95a34b8a8",
  "office-workers":  "92d6d951-ca5e-429c-ac78-451071cbf064",
  "monsters":        "36fd93ea-e8b8-445e-b836-358f02b3d33d",
  "survival":        "5fff9cde-849c-4d78-aab0-0d52b2ee1d25",
  "time-travel":     "292e862b-2d17-4062-90a2-0356caa4ae27",
  "delinquents":     "da2d50ca-3a55-4d5a-8b50-4b98335d5ab4",
  "ghosts":          "3bb26d85-09d5-4d2e-880b-c741a75de60e",
  "ninja":           "489dd859-9b61-4c37-af75-5b18e88daafc",
  "samurai":         "81183756-1453-4c81-aa9e-f6e1b63be016",
  "vampires":        "d14ea463-4248-4f3f-8f35-2d128e9b50e5",
  "gyaru":           "9ab53f92-3eed-4e9b-903a-917c86035ee3",
};

// Shounen/shoujo/seinen/josei use publicationDemographic[] — NOT tag UUIDs
const DEMOGRAPHICS = { "shounen":"shounen","shoujo":"shoujo","seinen":"seinen","josei":"josei" };

/* ── Shared query builder ─────────────────────────────────────── */
function listQ(offset, extra) {
  return `/manga?limit=20&offset=${offset}`
    + `&order[followedCount]=desc`
    + `&includes[]=cover_art`
    + `&contentRating[]=safe&contentRating[]=suggestive`
    + (extra || "");
}

/* ═══════════════════════════════════════════════════════════════
   MAIN HANDLER
═══════════════════════════════════════════════════════════════ */
module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  // Use modern URL API — avoids deprecated url.parse() in Node 24
  const reqUrl  = req.url || "/";
  const parsed  = new URL(reqUrl, "http://localhost");
  const url     = parsed.pathname;
  const p       = Object.fromEntries(parsed.searchParams.entries());

  try {

    /* ── ROOT ─────────────────────────────────────────────────── */
    if (url === "/") return res.json({ status:"ok", sources:["MangaDex","ComicK"] });

    /* ── LIST ─────────────────────────────────────────────────── */
    if (url === "/list" || url.startsWith("/list")) {
      const page   = Math.max(1, parseInt(p.page) || 1);
      const offset = (page - 1) * 20;
      const [mdxData, ckData] = await Promise.all([
        mdx(listQ(offset)),
        comick(`/top?page=${page}`),
      ]);
      const mdxMangas = ((mdxData && mdxData.data) || []).map(fmt).filter(Boolean);
      const ckMangas  = ((ckData && ckData.rank)   || []).map(fmtCk).filter(Boolean);
      const mangas    = dedup([...mdxMangas, ...ckMangas]);
      const total     = Math.min(Math.ceil(((mdxData && mdxData.total) || 200) / 20), 50);
      return res.json({ mangas, currentPage:page, totalPages:total, hasNextPage:page<total });
    }

    /* ── SEARCH ───────────────────────────────────────────────── */
    if (url.startsWith("/search")) {
      const q = p.query || "";
      if (!q) return res.json({ mangas:[], currentPage:1, totalPages:1 });
      const page   = Math.max(1, parseInt(p.page) || 1);
      const offset = (page - 1) * 20;
      const [mdxData, ckData] = await Promise.all([
        mdx(`/manga?limit=20&offset=${offset}&title=${encodeURIComponent(q)}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive`),
        comick(`/v1.0/search?q=${encodeURIComponent(q)}&limit=20&page=${page}`),
      ]);
      const mdxMangas = ((mdxData && mdxData.data) || []).map(fmt).filter(Boolean);
      const ckMangas  = (Array.isArray(ckData) ? ckData : []).map(fmtCk).filter(Boolean);
      const mangas    = dedup([...mdxMangas, ...ckMangas]);
      const total     = Math.min(Math.ceil(((mdxData && mdxData.total) || 20) / 20), 20);
      return res.json({ mangas, currentPage:page, totalPages:total, hasNextPage:page<total });
    }

    /* ── GENRE ────────────────────────────────────────────────── */
    if (url.startsWith("/genre")) {
      const genre  = (p.genre || "").toLowerCase();
      const page   = Math.max(1, parseInt(p.page) || 1);
      const offset = (page - 1) * 20;

      let extra = "";
      if (DEMOGRAPHICS[genre]) {
        extra = `&publicationDemographic[]=${DEMOGRAPHICS[genre]}`;
      } else if (TAGS[genre]) {
        extra = `&includedTags[]=${TAGS[genre]}`;
      } else {
        return res.json({ mangas:[], currentPage:1, totalPages:1 });
      }

      const data   = await mdx(listQ(offset, extra));
      const mangas = ((data && data.data) || []).map(fmt).filter(Boolean);
      const total  = Math.min(Math.ceil(((data && data.total) || 200) / 20), 25);
      return res.json({ mangas, currentPage:page, totalPages:total, hasNextPage:page<total });
    }

    /* ── MANGA DETAIL ─────────────────────────────────────────── */
    if (url.startsWith("/manga/")) {
      const rawId  = decodeURIComponent(url.replace("/manga/", ""));
      const page   = Math.max(1, parseInt(p.page) || 1);
      const offset = (page - 1) * 100;
      const lang   = p.lang || "en";

      /* ComicK manga detail */
      if (rawId.startsWith("ck:")) {
        const hid = rawId.replace("ck:", "");
        const [comicData, chapData] = await Promise.all([
          comick(`/comic/${hid}`),
          comick(`/comic/${hid}/chapters?lang=${lang}&limit=500&page=1`),
        ]);
        const base = fmtCk((comicData && (comicData.comic || comicData)));
        if (!base) return res.status(404).json({ error:"Manga not found" });

        let chapters = ((chapData && chapData.chapters) || []).map(c => ({
          id:   "ck:" + c.hid,
          name: "Chapter " + (c.chap || "?"),
          date: c.created_at ? c.created_at.split("T")[0] : "",
          lang: lang,
        }));

        // If no chapters for requested lang, try without lang filter
        if (chapters.length === 0) {
          const allChaps = await comick(`/comic/${hid}/chapters?limit=500&page=1`);
          chapters = ((allChaps && allChaps.chapters) || []).map(c => ({
            id:   "ck:" + c.hid,
            name: "Chapter " + (c.chap || "?"),
            date: c.created_at ? c.created_at.split("T")[0] : "",
            lang: c.lang || "",
          }));
        }

        return res.json({ ...base, chapters, chapterPages: 1 });
      }

      /* MangaDex manga detail */
      const id = rawId.replace(/^mdx:/, "");
      const [mangaData, feed] = await Promise.all([
        mdx(`/manga/${id}?includes[]=cover_art`),
        mdx(`/manga/${id}/feed?limit=500&offset=${offset}&order[chapter]=desc&translatedLanguage[]=${lang}`),
      ]);

      const base = fmt(mangaData && mangaData.data);
      if (!base) return res.status(404).json({ error:"Manga not found" });

      let chapters = ((feed && feed.data) || []).map(c => ({
        id:   "mdx:" + c.id,
        name: "Chapter " + (c.attributes.chapter || "?"),
        date: c.attributes.publishAt ? c.attributes.publishAt.split("T")[0] : "",
        lang: c.attributes.translatedLanguage || "",
      }));

      // No chapters in requested lang → fall back to ALL languages
      if (chapters.length === 0) {
        const all = await mdx(`/manga/${id}/feed?limit=500&offset=${offset}&order[chapter]=desc`);
        chapters = ((all && all.data) || []).map(c => ({
          id:   "mdx:" + c.id,
          name: "Chapter " + (c.attributes.chapter || "?"),
          date: c.attributes.publishAt ? c.attributes.publishAt.split("T")[0] : "",
          lang: c.attributes.translatedLanguage || "",
        }));
      }

      return res.json({
        ...base,
        chapters,
        chapterPages: Math.ceil(((feed && feed.total) || chapters.length) / 100) || 1,
      });
    }


    /* ── CHAPTER ──────────────────────────────────────────────── */
    if (url.startsWith("/chapter/")) {
      const raw    = decodeURIComponent(url.replace("/chapter/", ""));
      const prefix = raw.startsWith("ck:") ? "ck" : "mdx";
      const id     = raw.replace(/^(mdx:|ck:)/, "");

      /* ComicK chapters */
      if (prefix === "ck") {
        const data = await comick(`/chapter/${id}`);
        if (!data) return res.status(500).json({ error: "ComicK chapter not found", id });

        const chap = data.chapter || data;
        const imgs = chap.md_images || chap.images || data.images || [];

        if (!imgs.length) return res.status(500).json({ error: "No images in ComicK chapter", id });

        const images = imgs.map((img, i) => {
          const key = typeof img === "string" ? img : (img.b2key || img.name || "");
          return { img: `https://meo.comick.pictures/${key}`, page: i + 1 };
        }).filter(x => x.img && x.img !== "https://meo.comick.pictures/");

        return res.json(images);
      }

      /* MangaDex chapters — use retry */
      const data = await mdxRetry(`/at-home/server/${id}`);
      if (!data) return res.status(500).json({ error: "MangaDex at-home server unreachable", id });
      if (!data.chapter) return res.status(500).json({ error: "MangaDex chapter data missing", id, keys: Object.keys(data) });

      const baseUrl    = data.baseUrl;
      const hash       = data.chapter.hash;
      const fullFiles  = data.chapter.data || [];
      const saverFiles = data.chapter.dataSaver || [];

      // Prefer dataSaver if full is empty (sometimes happens)
      const useFiles  = fullFiles.length ? fullFiles : saverFiles;
      const usePath   = fullFiles.length ? "data" : "data-saver";
      const useHash   = hash;

      if (!useFiles.length) return res.status(500).json({ error: "No pages found", id, chapter: data.chapter });

      const images = useFiles.map((f, i) => ({
        img:      `${baseUrl}/${usePath}/${useHash}/${f}`,
        fallback: saverFiles[i] && usePath === "data"
                    ? `${baseUrl}/data-saver/${useHash}/${saverFiles[i]}`
                    : null,
        page:     i + 1,
      }));

      return res.json(images);
    }

    return res.status(404).json({ error:"Not found" });

  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
