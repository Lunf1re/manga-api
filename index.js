const axios = require("axios");
const { URL } = require("url");

/* ═══════════════════════════════════════════════════════════════
   SOURCE BASES
═══════════════════════════════════════════════════════════════ */
const MDX    = "https://api.mangadex.org";
const COMICK = "https://api.comick.io";
const MSEE   = "https://mangasee123.com";
const MKK    = "https://www.mangakakalot.gg";

const http = axios.create({ timeout: 8000 });

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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
    const r = await http.get(MDX + path, { headers: { "User-Agent": "MangaProxy/4.0" } });
    return r.data;
  } catch (e) {
    console.error("MDX error", path, e?.response?.status, e?.message);
    return null;
  }
}

async function comick(path) {
  try {
    const r = await http.get(COMICK + path, {
      headers: { "User-Agent": BROWSER_UA, "Referer": "https://comick.fun/" },
    });
    return r.data;
  } catch (e) {
    console.error("ComicK error", path, e?.response?.status, e?.message);
    return null;
  }
}

async function mseeGet(path) {
  try {
    const r = await http.get(MSEE + path, {
      headers: { "User-Agent": BROWSER_UA, "Referer": MSEE, "Accept": "text/html,*/*" },
    });
    return r.data;
  } catch (e) {
    console.error("MangaSee error", path, e?.response?.status, e?.message);
    return null;
  }
}

async function mkkGet(path, referer) {
  try {
    const r = await http.get(MKK + path, {
      headers: { "User-Agent": BROWSER_UA, "Referer": referer || MKK, "Accept": "text/html,*/*" },
    });
    return r.data;
  } catch (e) {
    console.error("MKK error", path, e?.response?.status, e?.message);
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
  const s    = String(chapterEncoded);
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

/* MangaSee catalogue cache — used for search */
let mseeCat   = null;
let mseeCatTs = 0;
async function getMseeCatalogue() {
  if (mseeCat && Date.now() - mseeCatTs < 30 * 60 * 1000) return mseeCat;
  try {
    const html = await mseeGet("/search/");
    if (!html) return [];
    const m = html.match(/vm\.Directory\s*=\s*(\[[\s\S]*?\]);/);
    if (!m) return [];
    mseeCat   = JSON.parse(m[1]);
    mseeCatTs = Date.now();
    return mseeCat;
  } catch { return []; }
}

/* ═══════════════════════════════════════════════════════════════
   MANGAKAKALOT HELPERS
═══════════════════════════════════════════════════════════════ */

function mkkImages(html) {
  const imgs = [];
  // Primary selector: class="img-loading" OR class="chapter-img"
  const re = /(?:img-loading|chapter-img)[^>]*src="([^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) imgs.push(m[1]);
  if (imgs.length) return imgs;
  // Fallback: imgs inside .container-chapter-reader
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
  const chapters = [];
  const seen = new Set();
  let m;
  while ((m = re.exec(html)) !== null) {
    const cid = m[1].trim();
    if (!seen.has(cid)) {
      seen.add(cid);
      chapters.push({ id: "mkk:" + cid, name: m[2].trim(), date: "", lang: "en" });
    }
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
  const title = a.title
    ? (a.title.en || a.title["ja-ro"] || a.title.ja || Object.values(a.title)[0] || "Unknown")
    : "Unknown";
  const desc  = a.description ? (a.description.en || Object.values(a.description)[0] || "") : "";
  const cover = (m.relationships || []).find(r => r.type === "cover_art");
  const image = cover?.attributes?.fileName
    ? `https://uploads.mangadex.org/covers/${m.id}/${cover.attributes.fileName}.256.jpg` : "";
  const genres = (a.tags || [])
    .filter(t => t.attributes?.group === "genre" || t.attributes?.group === "theme")
    .map(t => t.attributes?.name?.en).filter(Boolean).slice(0, 6);
  return {
    id: "mdx:" + m.id, title, image,
    description: desc.substring(0, 300), status: a.status || "", genres,
    latestChapter: a.lastChapter || "", source: "MangaDex",
    demographic: a.publicationDemographic || "", year: a.year || "",
  };
}

function fmtCk(m) {
  if (!m) return null;
  const md = m.md_comics || m;
  const title = md.title || md.slug || "Unknown";
  const image = md.cover_url ||
    (md.md_covers?.[0] && `https://meo.comick.pictures/${md.md_covers[0].b2key}`) || "";
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
};
const DEMOGRAPHICS = { "shounen":"shounen","shoujo":"shoujo","seinen":"seinen","josei":"josei" };

function listQ(offset, extra) {
  return `/manga?limit=20&offset=${offset}&order[followedCount]=desc&includes[]=cover_art`
    + `&contentRating[]=safe&contentRating[]=suggestive` + (extra || "");
}

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
    if (url === "/") return res.json({ status: "ok", sources: ["MangaDex", "ComicK", "MangaSee", "Mangakakalot"] });

    /* ── LIST ───────────────────────────────────────────────────── */
    if (url === "/list" || url.startsWith("/list")) {
      const page   = Math.max(1, parseInt(p.page) || 1);
      const offset = (page - 1) * 20;
      const [mdxData, ckData] = await Promise.all([
        mdx(listQ(offset)),
        comick(`/top?page=${page}`),
      ]);
      const mangas = dedup([
        ...((mdxData?.data || []).map(fmt).filter(Boolean)),
        ...((ckData?.rank   || []).map(fmtCk).filter(Boolean)),
      ]);
      const total = Math.min(Math.ceil(((mdxData?.total) || 200) / 20), 50);
      return res.json({ mangas, currentPage: page, totalPages: total, hasNextPage: page < total });
    }

    /* ── SEARCH ─────────────────────────────────────────────────── */
    if (url.startsWith("/search")) {
      const q    = (p.q || "").trim();
      const page = Math.max(1, parseInt(p.page) || 1);
      if (!q) return res.json({ mangas: [], currentPage: 1, totalPages: 1, hasNextPage: false });
      const offset = (page - 1) * 20;

      const [mdxData, ckData, mseeCatalogue] = await Promise.all([
        mdx(`/manga?limit=20&offset=${offset}&title=${encodeURIComponent(q)}&includes[]=cover_art&contentRating[]=safe&contentRating[]=suggestive&order[relevance]=desc`),
        comick(`/v1.0/search?q=${encodeURIComponent(q)}&limit=10`),
        getMseeCatalogue(),
      ]);

      const qLow       = q.toLowerCase();
      const mseeResults = (mseeCatalogue || [])
        .filter(m => (m.s || "").toLowerCase().includes(qLow)).slice(0, 8)
        .map(fmtMsee).filter(Boolean);

      const mangas = dedup([
        ...((mdxData?.data || []).map(fmt).filter(Boolean)),
        ...((ckData         || []).slice(0, 10).map(fmtCk).filter(Boolean)),
        ...mseeResults,
      ]);
      const total = Math.max(1, Math.ceil(((mdxData?.total) || mangas.length) / 20));
      return res.json({ mangas, currentPage: page, totalPages: total, hasNextPage: page < total });
    }

    /* ── GENRE ──────────────────────────────────────────────────── */
    if (url.startsWith("/genre")) {
      const genre  = (p.genre || "action").toLowerCase();
      const page   = Math.max(1, parseInt(p.page) || 1);
      const offset = (page - 1) * 20;
      const extra  = DEMOGRAPHICS[genre] ? `&publicationDemographic[]=${DEMOGRAPHICS[genre]}`
                   : TAGS[genre]         ? `&includedTags[]=${TAGS[genre]}` : "";
      const mdxData = await mdx(listQ(offset, extra));
      const mangas  = ((mdxData?.data || []).map(fmt).filter(Boolean));
      const total   = Math.min(Math.ceil(((mdxData?.total) || 20) / 20), 50);
      return res.json({ mangas, currentPage: page, totalPages: total, hasNextPage: page < total });
    }

    /* ── MANGA DETAIL ───────────────────────────────────────────── */
    if (url.startsWith("/manga/")) {
      const rawId = decodeURIComponent(url.replace("/manga/", ""));
      const lang  = p.lang || "en";

      /* ComicK */
      if (rawId.startsWith("ck:")) {
        const hid = rawId.replace("ck:", "");
        const [comicData, chapData] = await Promise.all([
          comick(`/comic/${hid}`),
          comick(`/comic/${hid}/chapters?lang=${lang}&limit=500&page=1`),
        ]);
        const base = fmtCk(comicData && (comicData.comic || comicData));
        if (!base) return res.status(404).json({ error: "Manga not found" });
        let chapters = ((chapData?.chapters) || []).map(c => ({
          id: "ck:" + c.hid, name: "Chapter " + (c.chap || "?"),
          date: c.created_at?.split("T")[0] || "", lang,
        }));
        // DO NOT fall back to all languages — return empty if none for this language
        // Frontend will show "no chapters for this language" message
        return res.json({ ...base, chapters, chapterPages: 1 });
      }

      /* MangaSee */
      if (rawId.startsWith("msee:")) {
        const slug = rawId.replace("msee:", "");
        const html = await mseeGet(`/manga/${slug}`);
        if (!html) return res.status(404).json({ error: "MangaSee manga not found" });
        const chapList = mseeExtractArr(html, "vm\\.Chapters");
        const title    = (html.match(/<h1>([^<]+)<\/h1>/) || html.match(/<title>([^<]+)<\/title>/) || [])[1]
                          ?.replace(/ - MangaSee.*/, "").trim() || slug;
        const image    = (html.match(/property="og:image"[^>]*content="([^"]+)"/) || [])[1]
                          || `https://temp.compsci88.com/cover/${slug}.jpg`;
        const desc     = (html.match(/property="og:description"[^>]*content="([^"]+)"/) || [])[1]
                          ?.substring(0, 300) || "";
        const chapters = (chapList || []).reverse().map(c => {
          const num = mseeDecodeChapter(c.Chapter);
          return { id: `msee:${slug}:${c.Chapter}`, name: `Chapter ${num}`, date: c.Date?.split(" ")[0] || "", lang: "en" };
        });
        return res.json({
          id: rawId, title, image, description: desc,
          status: "", genres: [], source: "MangaSee",
          latestChapter: chapters.at(-1)?.name || "",
          chapters, chapterPages: 1,
        });
      }

      /* Mangakakalot */
      if (rawId.startsWith("mkk:")) {
        const mangaId = rawId.replace("mkk:", "");
        const html = await mkkGet(`/manga/${mangaId}`);
        if (!html) return res.status(404).json({ error: "Mangakakalot manga not found" });
        const info = mkkMangaInfo(html);
        if (!info) return res.status(404).json({ error: "Mangakakalot parse failed" });
        const chapters = mkkChapters(html).reverse();
        return res.json({
          id: rawId, ...info,
          latestChapter: chapters.at(-1)?.name || "",
          chapters, chapterPages: 1,
        });
      }

      /* MangaDex */
      const id = rawId.replace(/^mdx:/, "");
      async function fetchAllChapters(langFilter) {
        const first = await mdx(`/manga/${id}/feed?limit=500&offset=0&order[chapter]=desc${langFilter}`);
        if (!first?.data) return [];
        let all = [...first.data];
        if ((first.total || 0) > 500) {
          await new Promise(r => setTimeout(r, 200));
          const r2 = await mdx(`/manga/${id}/feed?limit=500&offset=500&order[chapter]=desc${langFilter}`);
          if (r2?.data) all = all.concat(r2.data);
        }
        return all;
      }
      const [mangaData, rawChapters] = await Promise.all([
        mdx(`/manga/${id}?includes[]=cover_art`),
        fetchAllChapters(`&translatedLanguage[]=${lang}`),
      ]);
      const base = fmt(mangaData?.data);
      if (!base) return res.status(404).json({ error: "Manga not found" });

      // STRICT: only use requested language — never mix in other languages
      let chapterData = rawChapters;

      // If lang=en and no results, try es-la as a common fallback but ONLY for english
      // DO NOT fall back to ALL languages — that causes language contamination
      if (!chapterData.length && lang === "en") {
        // Try English variants only
        const enVariants = ["en"];
        // If still nothing, return empty — frontend will show "no chapters for this language"
      }

      // Strict dedup: key includes lang to ensure no cross-language contamination
      const seen = new Map();
      chapterData.forEach(c => {
        const chLang = c.attributes.translatedLanguage || "";
        // STRICTLY filter: only keep chapters matching requested lang
        if (chLang !== lang) return;
        const key = `${chLang}:::${c.attributes.chapter || "?"}`;
        if (!seen.has(key)) seen.set(key, c);
      });

      const chapters = Array.from(seen.values())
        .sort((a, b) => (parseFloat(b.attributes.chapter) || 0) - (parseFloat(a.attributes.chapter) || 0))
        .map(c => ({
          id: "mdx:" + c.id,
          name: "Chapter " + (c.attributes.chapter || "?"),
          date: c.attributes.publishAt?.split("T")[0] || "",
          lang: c.attributes.translatedLanguage || "",
        }));
      return res.json({ ...base, chapters, chapterPages: 1 });
    }

    /* ── CHAPTER ────────────────────────────────────────────────── */
    if (url.startsWith("/chapter/")) {
      const raw = decodeURIComponent(url.replace("/chapter/", ""));

      /* ComicK */
      if (raw.startsWith("ck:")) {
        const id   = raw.replace("ck:", "");
        const data = await comick(`/chapter/${id}`);
        if (!data) return res.status(500).json({ error: "ComicK chapter not found" });
        const imgs = (data.chapter?.md_images || data.chapter?.images || data.images || []);
        if (!imgs.length) return res.status(500).json({ error: "No images in ComicK chapter" });
        return res.json(imgs.map((img, i) => {
          const key = typeof img === "string" ? img : (img.b2key || img.name || "");
          return { img: `https://meo.comick.pictures/${key}`, page: i + 1 };
        }).filter(x => x.img !== "https://meo.comick.pictures/"));
      }

      /* MangaSee  id = "msee:Slug:ChapterEncoded" */
      if (raw.startsWith("msee:")) {
        const parts     = raw.split(":");
        const slug      = parts[1];
        const chEncoded = parts[2];
        const chNum     = mseeDecodeChapter(chEncoded);
        const html      = await mseeGet(`/read-online/${slug}-chapter-${chNum}.html`);
        if (!html) return res.status(500).json({ error: "MangaSee chapter not found" });
        const pathName  = mseeExtractVar(html, "vm\\.CurPathName");
        const curChap   = mseeExtractObj(html, "vm\\.CurChapter");
        const pages     = parseInt(curChap?.Page || "0", 10);
        if (!pathName || !pages) return res.status(500).json({ error: "MangaSee: could not parse chapter data" });
        const images = [];
        for (let i = 1; i <= pages; i++) {
          images.push({
            img:  `/img?url=${encodeURIComponent(mseeImgUrl(pathName, slug, chEncoded, i))}&ref=${encodeURIComponent(MSEE + "/read-online/" + slug + "-chapter-" + chNum + ".html")}`,
            page: i,
          });
        }
        return res.json(images);
      }

      /* Mangakakalot  id = "mkk:manga-id/chapter-N" */
      if (raw.startsWith("mkk:")) {
        const chapterId = raw.replace("mkk:", "");
        const mangaSlug = chapterId.split("/")[0];
        const html = await mkkGet(`/chapter/${chapterId}`, `${MKK}/manga/${mangaSlug}`);
        if (!html) return res.status(500).json({ error: "Mangakakalot chapter not found" });
        const imgs = mkkImages(html);
        if (!imgs.length) return res.status(500).json({ error: "No images in Mangakakalot chapter" });
        return res.json(imgs.map((imgUrl, i) => ({
          img:  `/img?url=${encodeURIComponent(imgUrl)}&ref=${encodeURIComponent(MKK)}`,
          page: i + 1,
        })));
      }

      /* MangaDex */
      const id = raw.replace(/^mdx:/, "");
      let data = await mdx(`/at-home/server/${id}`);
      if (!data?.chapter) {
        await new Promise(r => setTimeout(r, 400));
        data = await mdx(`/at-home/server/${id}`);
      }
      if (!data?.chapter) return res.status(500).json({ error: "MangaDex at-home server unavailable", id });
      const baseUrl    = data.baseUrl;
      const hash       = data.chapter.hash;
      const fullFiles  = data.chapter.data || [];
      const saverFiles = data.chapter.dataSaver || [];
      const useFiles   = fullFiles.length ? fullFiles : saverFiles;
      const usePath    = fullFiles.length ? "data" : "data-saver";
      if (!useFiles.length) return res.status(500).json({ error: "No pages found", id });
      return res.json(useFiles.map((f, i) => {
        const direct = `${baseUrl}/${usePath}/${hash}/${f}`;
        const saver  = saverFiles[i] && usePath === "data" ? `${baseUrl}/data-saver/${hash}/${saverFiles[i]}` : null;
        return {
          img:      `/img?url=${encodeURIComponent(direct)}`,
          fallback: saver ? `/img?url=${encodeURIComponent(saver)}` : null,
          page:     i + 1,
        };
      }));
    }

    /* ── IMAGE PROXY ────────────────────────────────────────────── */
    if (url === "/img") {
      const imgUrl  = p.url;
      const referer = p.ref ? decodeURIComponent(p.ref) : "https://mangadex.org/";
      if (!imgUrl) return res.status(400).json({ error: "Missing url param" });

      const tryFetch = async (target) => {
        const r = await http.get(target, {
          responseType: "stream", timeout: 8000,
          headers: { "Referer": referer, "User-Agent": BROWSER_UA },
        });
        if (r.status === 404) throw new Error("404");
        return r;
      };

      // MangaDex fallback: swap CDN node → uploads.mangadex.org
      const isMdx = imgUrl.includes("mangadex");
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
