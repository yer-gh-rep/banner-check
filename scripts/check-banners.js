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
 * Skips the "Videos" category, since those pages embed a video player that
 * keeps making network requests indefinitely and can hang the page load.
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
      const u = new URL(c.href);
      return u.host === host && !/\/videos\//i.test(u.pathname);
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
  // looks like an article rather than nav/category/author/tag pages, and
  // skip the Videos category (video embeds can hang page loads).
  const links = await page.$$eval("a[href]", (as) => as.map((a) => a.href));
  const EXCLUDE = /\/(author|category|tag|page|feed|wp-content|wp-json|videos)\//;
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
  await page.waitForTimeout(1000); // settle after scrolling back to top
}

// Placements that count toward the "main" near-top mobile crop. The
// in-article banner is deliberately excluded — it can sit far down mid-post
// and gets its own dedicated close-up screenshot instead (see below).
const PRIMARY_CROP_KEYS = ["top-banner", "in-content-banner"];

/** Check each banner placement: present in DOM, visibly rendered, and where
 * it sits on the page. A selector can match multiple elements (e.g. a
 * desktop-only container and a mobile-only container for the same
 * placement) — "rendered" means at least one of them actually has size,
 * not just the first match in DOM order (which may be the hidden one). */
async function checkBanners(page) {
  const results = {};
  let primaryMaxBottom = 0;
  for (const check of BANNER_CHECKS) {
    const handles = await page.$$(check.selector);
    if (handles.length === 0) {
      results[check.key] = { found: false, rendered: false };
      continue;
    }
    let rendered = false;
    for (const handle of handles) {
      const box = await handle.boundingBox();
      if (box && box.width > 10 && box.height > 10) {
        rendered = true;
        if (PRIMARY_CROP_KEYS.includes(check.key)) {
          primaryMaxBottom = Math.max(primaryMaxBottom, box.y + box.height);
        }
      }
    }
    results[check.key] = { found: true, rendered };
  }
  return { results, primaryMaxBottom };
}

async function captureOnePage(page, siteName, pageLabel, url, deviceKey, viewport, outDir) {
  // "networkidle" never resolves on pages with a video embed (continuous
  // buffering/analytics requests), causing a guaranteed timeout on every
  // "Videos" category post. Wait for the DOM instead, then give assets a
  // fixed window to settle.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(3000);
  // Scroll through the page so lazy-loaded sidebar/in-content ad slots
  // actually render before we check or screenshot them.
  await scrollThroughPage(page);

  const { results, primaryMaxBottom } = await checkBanners(page);
  const fileName = `${siteName}-${pageLabel}-${deviceKey}.png`;
  let extraFiles = [];

  if (deviceKey === "desktop") {
    // Desktop: full page, uncropped — includes the sidebar so you can
    // see webinar/report-download widgets etc., not just ad slots.
    await page.screenshot({
      path: path.join(outDir, fileName),
      fullPage: true,
      timeout: 60000,
    });
  } else {
    // Mobile: crop to just past the top banner + in-content banner — the
    // same formula and same 2-screen cap on every page, so the homepage
    // and an article land in the same position. The in-article banner is
    // NOT part of this crop (see below).
    const PADDING_BELOW = 200;
    const pageHeight = await page.evaluate(
      () => document.documentElement.scrollHeight
    );
    const ceiling = Math.min(viewport.height * 2, pageHeight);
    const cropHeight = primaryMaxBottom
      ? Math.min(primaryMaxBottom + PADDING_BELOW, ceiling)
      : ceiling;
    await page.screenshot({
      path: path.join(outDir, fileName),
      clip: { x: 0, y: 0, width: viewport.width, height: cropHeight },
      timeout: 60000,
    });

    // On mobile articles, also take a dedicated close-up of the in-article
    // (Advanced Ads) banner itself, wherever it sits mid-post — separate
    // from the near-top crop above, since it can be many screens further
    // down. One image per placement found, in case an article has more
    // than one "between paragraph" ad.
    if (pageLabel === "article") {
      const inArticleHandles = await page.$$(".fintech-entity-placement");
      let n = 0;
      for (const handle of inArticleHandles) {
        const box = await handle.boundingBox();
        if (box && box.width > 10 && box.height > 10) {
          n++;
          const extraFile = `${siteName}-${pageLabel}-${deviceKey}-in-article-${n}.png`;
          await handle.screenshot({
            path: path.join(outDir, extraFile),
            timeout: 60000,
          });
          extraFiles.push(extraFile);
        }
      }
    }
  }

  return { file: fileName, extraFiles, banners: results, ok: true };
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
      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForTimeout(2000);
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
