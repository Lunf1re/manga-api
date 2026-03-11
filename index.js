const axios  = require("axios");
const cheerio = require("cheerio");
const { URL } = require("url");

const BASE   = "https://chapmanganato.to";
const SEARCH = "https://manganato.com";
const IMG_CDN = "https://v1.mkklcdnv6temp.com";

const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const ax = axios.create({ timeout: 12000, headers: { "User-Agent": ua, "Referer": BASE } });

/* ── Cache ── */
const cache = new Map();
function cget(k) { const e=cache.get(k); if(!e||Date.now()>e.x){cache.delete(k);return null;} return e.v; }
function cset(k,v,t) { if(cache.size>200) cache.delete(cache.keys().next().value); cache.set(k,{v,x:Date.now()+t}); }
async function wc(k,t,fn) { const h=cget(k); if(h!==null)return h; const v=await fn(); if(v!=null)cset(k,v,t); return v; }

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin","*");
  res.setHeader("Access-Control-Allow-Methods","GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers","*");
}

async function get(url) {
  const r = await ax.get(url, { headers: { "Referer": url.includes("manganato") ? "https://manganato.com" : BASE }});
  return r.data;
}

/* ── Scrape manga list from manganato ── */
async function scrapeList(url) {
  const html = await get(url);
  const $ = cheerio.load(html);
  const mangas = [];
  $(".content-genres-item, .list-truyen-item-wrap, .search-story-item, .itemupdate").each((_, el) => {
    const a    = $(el).find("h3 a, .genres-item-name, .item-title a").first();
    const img  = $(el).find("img").first();
    const ch   = $(el).find("a.genres-item-chap, .list-story-item-wrap-chapter a, span.chapter a").first();
    const title = a.text().trim() || img.attr("alt") || "";
    const href  = a.attr("href") || "";
    const id    = href.replace(/^.*\/manga-/, "manga-").replace(/\/$/, "") || "";
    if (!title || !id) return;
    mangas.push({
      id:    "mnt:" + id,
      title,
      image: img.attr("src") || img.attr("data-src") || "",
      latestChapter: ch.text().trim() || "",
      source: "Manganato",
      genres: [],
      status: "",
      description: "",
    });
  });
  return mangas;
}

/* ── Scrape chapter images ── */
async function scrapeChapter(url) {
  const html = await get(url);
  const $ = cheerio.load(html);
  const pages = [];
  $(".container-chapter-reader img, .chapter-content img").each((i, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src") || "";
    if (src) pages.push({ img: src, page: i + 1 });
  });
  return pages;
}

/* ── Scrape manga detail ── */
async function scrapeManga(id) {
  const url  = `${BASE}/${id}`;
  const html = await get(url);
  const $    = cheerio.load(html);
  const title = $(".story-info-right h1").text().trim() || $(".manga-info-top h1").text().trim();
  const image = $(".manga-info-pic img, .info-image img").attr("src") || "";
  const desc  = $("#panel-story-info-description, .panel-story-info-description").text().replace(/^Description\s*:?\s*/i,"").trim().substring(0,400);
  const status = $(".variations-tableInfo tr").filter((_,r) => $(r).find("td").first().text().includes("Status")).find("td.table-value").text().trim().toLowerCase();
  const genres = [];
  $(".genres-content a, .list-category a").each((_,a) => { const g=$(a).text().trim(); if(g) genres.push(g); });

  const chapters = [];
  $(".row-content-chapter li, .chapter-list .row").each((_, el) => {
    const a    = $(el).find("a").first();
    const href = a.attr("href") || "";
    const name = a.text().trim();
    const date = $(el).find("span.chapter-time, span").last().attr("title") || $(el).find("span.chapter-time, span").last().text().trim() || "";
    if (!href || !name) return;
    // Extract chapter path from URL
    const chId = href.replace(`${BASE}/`, "");
    chapters.push({ id: "mnt-ch:" + chId, name, date, lang: "en" });
  });

  return { id: "mnt:"+id, title, image, description: desc, status, genres, latestChapter: chapters[0]?.name||"", source:"Manganato", chapters, chapterPages:1 };
}

/* ════════════════════════════════════════════════════════════════ */
module.exports = async (req, res) => {
  cors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const parsed = new URL(req.url||"/","http://localhost");
  const url    = parsed.pathname;
  const p      = Object.fromEntries(parsed.searchParams.entries());

  try {
    if (url === "/") return res.json({ status:"ok", source:"Manganato" });

    /* LIST */
    if (url==="/list"||url.startsWith("/list")) {
      const page = Math.max(1,parseInt(p.page)||1);
      const result = await wc(`list:${page}`, 5*60*1000, async () => {
        const mangas = await scrapeList(`${BASE}/manga-list-all/${page}`);
        return { mangas, currentPage:page, totalPages:200, hasNextPage:true };
      });
      return res.json(result||{mangas:[],currentPage:page,totalPages:1,hasNextPage:false});
    }

    /* SEARCH */
    if (url.startsWith("/search")) {
      const q    = (p.q||"").trim();
      const page = Math.max(1,parseInt(p.page)||1);
      if (!q) return res.json({mangas:[],currentPage:1,totalPages:1,hasNextPage:false});
      const result = await wc(`search:${q}:${page}`, 3*60*1000, async () => {
        const qenc = encodeURIComponent(q.replace(/\s+/g,"_"));
        const mangas = await scrapeList(`${SEARCH}/search/story/${qenc}?page=${page}`);
        return { mangas, currentPage:page, totalPages:mangas.length===24?page+1:page, hasNextPage:mangas.length===24 };
      });
      return res.json(result||{mangas:[],currentPage:page,totalPages:1,hasNextPage:false});
    }

    /* GENRE */
    if (url.startsWith("/genre")) {
      const genre = (p.genre||"all").toLowerCase().replace(/\s+/g,"-");
      const page  = Math.max(1,parseInt(p.page)||1);
      const GENRES = {
        "action":"2","adventure":"4","comedy":"6","drama":"7","fantasy":"9","romance":"23",
        "horror":"12","mystery":"18","sci-fi":"24","slice-of-life":"26","sports":"27",
        "supernatural":"28","martial-arts":"17","historical":"13","school-life":"25",
        "psychological":"21","shounen":"30","shoujo":"29","seinen":"40","josei":"41",
        "ecchi":"8","mecha":"16","isekai":"1","yuri":"37","yaoi":"36","cooking":"39",
        "thriller":"41","magic":"15","tragedy":"32",
      };
      const gid = GENRES[genre] || "all";
      const result = await wc(`genre:${genre}:${page}`, 5*60*1000, async () => {
        const gurl = gid==="all"
          ? `${BASE}/manga-list-all/${page}`
          : `${SEARCH}/genre-${gid}/${page}`;
        const mangas = await scrapeList(gurl);
        return { mangas, currentPage:page, totalPages:200, hasNextPage:true };
      });
      return res.json(result||{mangas:[],currentPage:page,totalPages:1,hasNextPage:false});
    }

    /* MANGA DETAIL */
    if (url.startsWith("/manga/")) {
      const rawId = decodeURIComponent(url.replace("/manga/",""));
      const id    = rawId.replace(/^mnt:/,"");
      const lang  = p.lang||"en";
      const result = await wc(`manga:${id}`, 10*60*1000, () => scrapeManga(id));
      if (!result) return res.status(404).json({error:"Manga not found"});
      return res.json(result);
    }

    /* CHAPTER */
    if (url.startsWith("/chapter/")) {
      const raw   = decodeURIComponent(url.replace("/chapter/",""));
      const chId  = raw.replace(/^mnt-ch:/,"");
      const chUrl = `${BASE}/${chId}`;
      const pages = await scrapeChapter(chUrl);
      if (!pages.length) return res.status(404).json({error:"No images found", id:raw});
      return res.json(pages);
    }

    /* IMAGE PROXY — needed because Manganato requires Referer header */
    if (url.startsWith("/img")) {
      const imgUrl = p.url;
      if (!imgUrl) return res.status(400).json({error:"No URL"});
      const r = await ax.get(imgUrl, {
        responseType: "stream",
        headers: { "Referer": BASE, "User-Agent": ua }
      });
      res.setHeader("Content-Type", r.headers["content-type"]||"image/jpeg");
      res.setHeader("Cache-Control","public,max-age=86400");
      r.data.pipe(res);
      return;
    }

    return res.status(404).json({error:"Not found"});

  } catch(e) {
    console.error(e.message);
    return res.status(500).json({error:e.message});
  }
};
