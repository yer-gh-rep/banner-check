import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { SITES, BANNER_CHECKS } from "./sites.js";

const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const OUT_DIR = path.join("banner-checks", today);
fs.mkdirSync(OUT_DIR, { recursive: true });

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
};

/**
 * Find the genuinely most recent article on the homepage by reading each
 * article's actual publish timestamp — not just DOM order, which can put a
 * sponsored post or a sidebar widget ahead of the real latest article.
 */
async function findLatestArticleUrl(page, siteUrl) {
  const host = new URL(siteUrl).host;

  const candidates = await page.$$eval("article", (articles) =>
    articles
      .map((article) => {
        const link =
          article.querySelector(".post-title a") ||
          article.querySelector("a[href]");
        const time = article.querySelector("time[datetime]");
        return {
          href: link ? link.href : null,
          datetime: time ? time.getAttribute("datetime") : null,
        };
      })
      .filter((c) => c.href && c.datetime)
  );

  const sameHostDated = candidates.filter((c) => {
    try {
      return new URL(c.href).host === host;
    } catch {
      return false;
    }
  });

  if (sameHostDated.length > 0) {
    sameHostDated.sort(
      (a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime()
    );
    return sameHostDated[0].href;
  }

  // Fallback: no dated <article> elements found — use the old heuristic
  // (first link matching this network's /12345/slug/ permalink pattern).
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  const fallback = links.find((href) => {
    try {
      const u = new URL(href);
      return u.host === host && /^\/\d{3,7}\//.test(u.pathname);
    } catch {
      return false;
    }
  });
  return fallback || null;
}

/**
 * Sidebar/in-content ad slots are usually lazy-loaded: they only render once
 * scrolled into view. A single full-page screenshot taken from the top does
 * NOT trigger that, so it can wrongly show them as empty. Scroll the whole
 * page in steps first so every lazy slot gets a chance to load.
 */
async function scrollThroughPage(page) {
  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    let last = -1;
    while (document.scrollingElement.scrollTop !== last) {
      last = document.scrollingElement.scrollTop;
      window.scrollBy(0, step);
      await new Promise((r) => setTimeout(r, 350));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500); // settle after scrolling back to top
}

/** Check each banner placement: present in DOM, visibly rendered, and where
 * it sits on the page (so we know how far down to crop the screenshot). */
async function checkBanners(page) {
  const results = {};
  let maxBottom = 0;
  for (const check of BANNER_CHECKS) {
    const handle = await page.$(check.selector);
    if (!handle) {
      results[check.key] = { found: false, rendered: false };
      continue;
    }
    const box = await handle.boundingBox();
    const rendered = !!box && box.width > 10 && box.height > 10;
    results[check.key] = { found: true, rendered };
    if (box) maxBottom = Math.max(maxBottom, box.y + box.height);
  }
  return { results, maxBottom };
}

async function shootPage(browser, siteName, pageLabel, url, outDir) {
  const perUrl = {};
  for (const [deviceKey, viewport] of Object.entries(VIEWPORTS)) {
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    let status = "error";
    let banners = {};
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(1500);
      // Scroll through the page so lazy-loaded sidebar/in-content ad slots
      // actually render before we check or screenshot them.
      await scrollThroughPage(page);

      const { results, maxBottom } = await checkBanners(page);
      banners = results;

      const fileName = `${siteName}-${pageLabel}-${deviceKey}.png`;

      if (deviceKey === "desktop") {
        // Desktop: full page, uncropped — includes the sidebar so you can
        // see webinar/report-download widgets etc., not just ad slots.
        await page.screenshot({
          path: path.join(outDir, fileName),
          fullPage: true,
        });
      } else {
        // Mobile: no sidebar to show, so crop to just past the main
        // banners instead of scrolling through the full article/feed.
        const PADDING_BELOW = 250;
        const pageHeight = await page.evaluate(
          () => document.documentElement.scrollHeight
        );
        const cropHeight = maxBottom
          ? Math.min(maxBottom + PADDING_BELOW, pageHeight)
          : pageHeight;
        await page.screenshot({
          path: path.join(outDir, fileName),
          clip: { x: 0, y: 0, width: viewport.width, height: cropHeight },
        });
      }

      perUrl[deviceKey] = { file: fileName, banners, ok: true };
      status = "ok";
    } catch (err) {
      perUrl[deviceKey] = { error: String(err), ok: false };
    } finally {
      await context.close();
    }
    console.log(`  ${pageLabel} [${deviceKey}]: ${status}`);
  }
  return perUrl;
}

async function main() {
  const browser = await chromium.launch();
  const report = { date: today, sites: {} };

  for (const site of SITES) {
    console.log(`\n${site.name} (${site.url})`);
    const siteReport = { url: site.url, home: null, article: null, articleUrl: null };

    // Homepage
    siteReport.home = await shootPage(browser, site.name, "home", site.url, OUT_DIR);

    // Discover + shoot the latest article
    try {
      const context = await browser.newContext({ viewport: VIEWPORTS.desktop });
      const page = await context.newPage();
      await page.goto(site.url, { waitUntil: "networkidle", timeout: 45000 });
      const articleUrl = await findLatestArticleUrl(page, site.url);
      await context.close();

      if (articleUrl) {
        siteReport.articleUrl = articleUrl;
        siteReport.article = await shootPage(
          browser,
          site.name,
          "article",
          articleUrl,
          OUT_DIR
        );
      } else {
        console.log("  could not find a latest-article link");
      }
    } catch (err) {
      console.log(`  article discovery failed: ${err}`);
    }

    report.sites[site.name] = siteReport;
  }

  await browser.close();
  fs.writeFileSync(
    path.join(OUT_DIR, "report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log(`\nDone. Report + screenshots written to ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
