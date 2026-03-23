import axios from "axios";
import * as cheerio from "cheerio";

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).send('Method Not Allowed');

  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "URL is required" });

  try {
    const parsedBase = new URL(url);
    const startUrl = parsedBase.href.replace(/\/$/, "");
    const baseHostname = parsedBase.hostname.replace(/^www\./, "");
    
    const visited = new Set<string>();
    const queue = [startUrl];
    const MAX_PAGES = 30; // Na początek 30, żeby zmieścić się w 10 sekundach

    // Główna pętla skanowania (iteracyjna zamiast rekurencyjnej - bezpieczniejsza dla Vercel)
    while (queue.length > 0 && visited.size < MAX_PAGES) {
      const currentUrl = queue.shift()!;
      if (visited.has(currentUrl)) continue;

      try {
        const response = await axios.get(currentUrl, {
          timeout: 3000, // Szybki timeout, żeby nie blokować funkcji
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
        });

        visited.add(currentUrl);
        const $ = cheerio.load(response.data);

        $("a").each((_, el) => {
          const href = $(el).attr("href");
          if (!href) return;

          try {
            const absolute = new URL(href, currentUrl);
            const normalized = absolute.href.replace(/\/$/, "").split('#')[0];
            const isSameDomain = absolute.hostname.replace(/^www\./, "") === baseHostname;

            if (isSameDomain && normalized.startsWith(startUrl) && !visited.has(normalized)) {
              queue.push(normalized);
            }
          } catch (e) {}
        });
      } catch (err) {
        console.error(`Failed: ${currentUrl}`);
      }
    }

    // Twoja logika budowania drzewa (Uproszczona)
    const sorted = Array.from(visited).sort();
    const root = { name: baseHostname, url: startUrl, children: [] };

    sorted.forEach(pageUrl => {
      if (pageUrl === startUrl) return;
      const name = pageUrl.replace(startUrl + "/", "");
      root.children.push({ name: name || pageUrl, url: pageUrl, children: [] });
    });

    return res.status(200).json(root);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}