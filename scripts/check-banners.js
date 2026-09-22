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

  // Fallback: no dated <article> elements found — grab the first link that
  // looks like an article rather than nav/category/author/tag pages.
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  const EXCLUDE = /\/(author|category|tag|page|feed|wp-content|wp-json)\//;
  const fallback = links.find((href) => {
    try {
      const u = new URL(href);
      return (
        u.host === host &&
        u.pathname.length > 1 &&
        !EXCLUDE.test(u.pathname)
      );
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

async function captureOnePage(page, siteName, pageLabel, url, deviceKey, viewport, outDir) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
  await page.waitForTimeout(1500);
  // Scroll through the page so lazy-loaded sidebar/in-content ad slots
  // actually render before we check or screenshot them.
  await scrollThroughPage(page);

  const { results } = await checkBanners(page);
  const fileName = `${siteName}-${pageLabel}-${deviceKey}.png`;

  if (deviceKey === "desktop") {
    // Desktop: full page, uncropped — includes the sidebar so you can
    // see webinar/report-download widgets etc., not just ad slots.
    await page.screenshot({
      path: path.join(outDir, fileName),
      fullPage: true,
      timeout: 60000,
    });
  } else {
    // Mobile: cap at two screen heights so the banners are always
    // visible near the top of the image, rather than trusting wherever
    // the banner's measured position happens to land after scrolling.
    const MOBILE_MAX_SCREENS = 2;
    const pageHeight = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    const cropHeight = Math.min(
      viewport.height * MOBILE_MAX_SCREENS,
      pageHeight
    );
    await page.screenshot({
      path: path.join(outDir, fileName),
      clip: { x: 0, y: 0, width: viewport.width, height: cropHeight },
      timeout: 60000,
    });
  }

  return { file: fileName, banners: results, ok: true };
}

async function shootPage(browser, siteName, pageLabel, url, outDir) {
  const perUrl = {};
  for (const [deviceKey, viewport] of Object.entries(VIEWPORTS)) {
    let status = "error";
    let lastError = null;

    // Try up to twice — a slow/flaky load shouldn't sink the whole capture.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      try {
        perUrl[deviceKey] = await captureOnePage(
          page,
          siteName,
          pageLabel,
          url,
          deviceKey,
          viewport,
          outDir
        );
        status = "ok";
      } catch (err) {
        lastError = err;
      } finally {
        await context.close();
      }
      if (status === "ok") break;
      if (attempt === 1) console.log(`    retrying ${pageLabel} [${deviceKey}]…`);
    }

    if (status !== "ok") {
      perUrl[deviceKey] = { error: String(lastError), ok: false };
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
      await page.goto(site.url, { waitUntil: "networkidle", timeout: 60000 });
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
