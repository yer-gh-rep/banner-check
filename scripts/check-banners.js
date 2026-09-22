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

/** Find the first real article link on a homepage (skips nav/menu links). */
async function findLatestArticleUrl(page, siteUrl) {
  const links = await page.$$eval("a[href]", (as) =>
    as.map((a) => a.href)
  );
  const host = new URL(siteUrl).host;
  // Heuristic matching this network's permalink structure: /12345/slug/
  const articleLink = links.find((href) => {
    try {
      const u = new URL(href);
      return u.host === host && /^\/\d{3,7}\//.test(u.pathname);
    } catch {
      return false;
    }
  });
  return articleLink || null;
}

/** Check each banner placement: present in DOM, and visibly rendered. */
async function checkBanners(page) {
  const results = {};
  for (const check of BANNER_CHECKS) {
    const handle = await page.$(check.selector);
    if (!handle) {
      results[check.key] = { found: false, rendered: false };
      continue;
    }
    // "Rendered" = has non-zero size (not a collapsed empty placeholder)
    const box = await handle.boundingBox();
    const rendered = !!box && box.width > 10 && box.height > 10;
    results[check.key] = { found: true, rendered };
  }
  return results;
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
      // give lazy-loaded ad slots a moment to render
      await page.waitForTimeout(2500);
      banners = await checkBanners(page);
      const fileName = `${siteName}-${pageLabel}-${deviceKey}.png`;
      await page.screenshot({
        path: path.join(outDir, fileName),
        fullPage: true,
      });
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
