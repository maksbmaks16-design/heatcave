import express from "express";
import { createServer as createViteServer } from "vite";
import axios from "axios";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  const router = express.Router();

  // API endpoint for crawling
  router.post("/api/crawl", async (req, res) => {
    const { url } = req.body;

    if (!url) {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const parsedBase = new URL(url);
      const baseHostname = parsedBase.hostname.replace(/^www\./, "");
      const visited = new Set<string>();
      const MAX_PAGES = 500; 

      function normalizeUrl(u: string) {
        try {
          const urlObj = new URL(u);
          urlObj.hash = "";
          // Usuwamy www z hosta dla spójności
          urlObj.hostname = urlObj.hostname.replace(/^www\./, "");
          let normalized = urlObj.href.replace(/\/$/, "");
          return normalized;
        } catch (e) {
          return null;
        }
      }

      const startUrlNormalized = normalizeUrl(url);
      if (!startUrlNormalized) throw new Error("Invalid URL");

      const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

      async function fetchWithRetry(targetUrl: string, retries = 3, backoff = 2000) {
        for (let i = 0; i < retries; i++) {
          try {
            // Dodajemy małe losowe opóźnienie przed każdym zapytaniem
            await sleep(500 + Math.random() * 500);
            
            const response = await axios.get(targetUrl, {
              timeout: 10000,
              maxRedirects: 5,
              headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'Accept-Language': 'pl-PL,pl;q=0.9,en-US;q=0.8,en;q=0.7',
                'Cache-Control': 'no-cache',
                'Pragma': 'no-cache'
              }
            });
            return response;
          } catch (error: any) {
            if (error.response?.status === 429 && i < retries - 1) {
              const waitTime = backoff * Math.pow(2, i) + Math.random() * 1000;
              console.log(`Rate limited (429) dla ${targetUrl}. Czekam ${Math.round(waitTime)}ms (próba ${i + 1}/${retries})...`);
              await sleep(waitTime);
              continue;
            }
            throw error;
          }
        }
      }

      async function collectUrls(currentUrl: string, depth: number) {
        const normalized = normalizeUrl(currentUrl);
        if (!normalized || visited.has(normalized) || visited.size >= MAX_PAGES || depth > 4) {
          return;
        }

        visited.add(normalized);
        console.log(`Crawling [${visited.size}]: ${normalized}`);

        try {
          const response = await fetchWithRetry(currentUrl);
          if (!response) return;
          
          const $ = cheerio.load(response.data);
          const links: string[] = [];

          $("a").each((_, element) => {
            const href = $(element).attr("href");
            if (href && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
              try {
                const absolute = normalizeUrl(new URL(href, currentUrl).href);
                if (absolute) {
                  const absObj = new URL(absolute);
                  const absHostname = absObj.hostname.replace(/^www\./, "");
                  if (absHostname === baseHostname && absolute.startsWith(startUrlNormalized)) {
                    links.push(absolute);
                  }
                }
              } catch (e) {}
            }
          });

          const uniqueLinks = Array.from(new Set(links)).filter(link => {
            const ext = path.extname(new URL(link).pathname).toLowerCase();
            const skipExts = ['.png', '.jpg', '.jpeg', '.gif', '.pdf', '.zip', '.mp4', '.mp3', '.css', '.js', '.svg', '.woff', '.woff2', '.ico'];
            return !skipExts.includes(ext) && !visited.has(link);
          });

          // Skanujemy dzieci sekwencyjnie, aby nie przeciążać serwera
          const childrenToScan = uniqueLinks.slice(0, 20);
          for (const link of childrenToScan) {
            if (visited.size < MAX_PAGES) {
              await collectUrls(link, depth + 1);
            }
          }
        } catch (error: any) {
          console.error(`Błąd skanowania ${currentUrl}:`, error.message);
        }
      }

      console.log(`Starting crawl for: ${startUrlNormalized}`);
      await collectUrls(startUrlNormalized, 0);
      console.log(`Crawl finished. Found ${visited.size} pages.`);


      // Budowanie uproszczonego drzewa (kategoryzacja 2-poziomowa)
      const root: any = { 
        name: parsedBase.hostname, 
        url: startUrlNormalized, 
        children: [] 
      };
      
      const categories: { [key: string]: any } = {};

      // Sortujemy alfabetycznie dla porządku
      const sortedUrls = Array.from(visited)
        .filter(u => u !== startUrlNormalized)
        .sort();

      for (const pageUrl of sortedUrls) {
        const relativePath = pageUrl.replace(startUrlNormalized, "").replace(/^\//, "");
        if (!relativePath) continue;

        const pathParts = relativePath.split('/').filter(p => p);
        
        if (pathParts.length === 1) {
          // Strona bezpośrednio pod rootem
          root.children.push({
            name: pathParts[0],
            url: pageUrl,
            children: []
          });
        } else {
          // Strona w kategorii (np. /blog/post)
          const categoryName = pathParts[0];
          if (!categories[categoryName]) {
            categories[categoryName] = {
              name: categoryName.toUpperCase(),
              url: `${startUrlNormalized}/${categoryName}`,
              children: [],
              isCategory: true
            };
            root.children.push(categories[categoryName]);
          }
          
          categories[categoryName].children.push({
            name: pathParts[pathParts.length - 1],
            url: pageUrl,
            children: []
          });
        }
      }

      console.log(`Simplified tree built with ${visited.size} pages.`);
      if (!res.headersSent) {
        res.json(root);
      }
    } catch (error: any) {
      console.error("Crawl error:", error.message);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to crawl website: " + error.message });
      }
    }
  });

  app.use("/sitemap", router);
  app.use("/", router); // Dodatkowa obsługa dla zapytań bez prefiksu /sitemap

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
      base: "/sitemap/",
    });
    app.use(vite.middlewares);
    app.get("/", (req, res) => {
      res.redirect("/sitemap");
    });
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use("/sitemap", express.static(distPath));
    app.get(["/sitemap", "/sitemap/*"], (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
    // Redirect root to /sitemap
    app.get("/", (req, res) => {
      res.redirect("/sitemap");
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  });
}

startServer();
