import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";

// Vercel używa standardowego handlera dla funkcji Node.js
export default async function handler(req, res) {
  // 1. Obsługujemy tylko metodę POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { url } = req.body;
  if (!url) {
    return res.status(400).json({ error: "URL is required" });
  }

  try {
    const parsedBase = new URL(url);
    const baseHostname = parsedBase.hostname.replace(/^www\./, "");
    const visited = new Set<string>();
    const MAX_PAGES = 50; // Na Vercel Hobby masz limit czasu (10s), nie skanuj 500 stron naraz!

    const normalizeUrl = (u: string) => {
      try {
        const urlObj = new URL(u);
        urlObj.hash = "";
        urlObj.hostname = urlObj.hostname.replace(/^www\./, "");
        return urlObj.href.replace(/\/$/, "");
      } catch (e) { return null; }
    };

    const startUrlNormalized = normalizeUrl(url);
    if (!startUrlNormalized) throw new Error("Invalid URL");

    // Funkcja skanująca (taka sama jak u Ciebie, ale ograniczona czasowo)
    async function collectUrls(currentUrl: string, depth: number) {
      const normalized = normalizeUrl(currentUrl);
      if (!normalized || visited.has(normalized) || visited.size >= MAX_PAGES || depth > 3) return;

      visited.add(normalized);

      try {
        const response = await axios.get(currentUrl, {
          timeout: 5000,
          headers: { 'User-Agent': 'Mozilla/5.0...' }
        });
        
        const $ = cheerio.load(response.data);
        const links: string[] = [];

        $("a").each((_, element) => {
          const href = $(element).attr("href");
          if (href && !href.startsWith('#') && !href.startsWith('mailto:')) {
            try {
              const absolute = normalizeUrl(new URL(href, currentUrl).href);
              if (absolute && absolute.includes(baseHostname)) links.push(absolute);
            } catch (e) {}
          }
        });

        for (const link of links.slice(0, 10)) {
          await collectUrls(link, depth + 1);
        }
      } catch (e) {}
    }

    await collectUrls(startUrlNormalized, 0);

    // Budowanie drzewa (Twoja logika)
    const root = { name: parsedBase.hostname, url: startUrlNormalized, children: [] };
    // ... tutaj wstaw swoją logikę budowania drzewa z `visited` ...

    return res.status(200).json(root);

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}