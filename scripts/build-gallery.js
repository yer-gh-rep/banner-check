import fs from "node:fs";
import path from "node:path";
import { RETENTION_DAYS, BANNER_CHECKS } from "./sites.js";

const ROOT = "banner-checks";
const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join(ROOT, today);
const reportPath = path.join(OUT_DIR, "report.json");

/**
 * Compare each banner placement across desktop vs mobile for one page.
 * Each device was captured in its own real browser context at that exact
 * viewport, so "found + rendered" there already reflects whether that
 * device's version is genuinely showing — no guessing needed about which
 * markup belongs to which device.
 *   - present on both  → ok (✅)
 *   - present on neither → not configured here, not an error (— greyed out)
 *   - present on only one → a real mismatch (❌)
 */
function compareBanners(desktopEntry, mobileEntry) {
  const desktopFailed = desktopEntry && !desktopEntry.ok;
  const mobileFailed = mobileEntry && !mobileEntry.ok;

  return BANNER_CHECKS.map((c) => {
    if (desktopFailed || mobileFailed) {
      return {
        cls: "unknown",
        html: `<span class="chk unknown" title="${c.label} — capture failed, unknown">❔ ${c.label}</span>`,
      };
    }

    const d = desktopEntry?.banners?.[c.key];
    const m = mobileEntry?.banners?.[c.key];
    const dOk = !!(d && d.found && d.rendered);
    const mOk = !!(m && m.found && m.rendered);

    let icon, cls, state;
    if (dOk && mOk) {
      icon = "✅"; cls = "ok"; state = "ok on both";
    } else if (!dOk && !mOk) {
      icon = "—"; cls = "none"; state = "not present (not configured here)";
    } else {
      icon = "❌"; cls = "mismatch";
      state = dOk ? "showing on desktop, missing on mobile" : "showing on mobile, missing on desktop";
    }

    return {
      cls,
      html: `<span class="chk ${cls}" title="${c.label} — ${state}">${icon} ${c.label}</span>`,
    };
  });
}

function captionFor(label) {
  const map = {
    "home desktop": "Homepage — Desktop (full page)",
    "home mobile": "Homepage — Mobile (first screen)",
    "article desktop": "Article — Desktop (full page)",
    "article mobile": "Article — Mobile (first screen)",
  };
  return map[label] || label;
}

function renderDevice(entry, siteName, label) {
  if (!entry || !entry.ok) {
    return `<div class="shot error"><p class="shot-caption">${captionFor(label)}</p><p>❌ failed to capture</p></div>`;
  }
  const extras = (entry.extraFiles || [])
    .map(
      (f, i) => `
        <p class="shot-caption">Article — Mobile — In-article banner #${i + 1}</p>
        <img loading="lazy" class="in-article-crop" src="${f}" alt="${siteName} ${label} in-article banner ${i + 1}">`
    )
    .join("");
  return `
    <div class="shot">
      <p class="shot-caption">${captionFor(label)}</p>
      <img loading="lazy" src="${entry.file}" alt="${siteName} ${label}">
      ${extras}
    </div>`;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function main() {
  if (!fs.existsSync(reportPath)) {
    console.error("No report.json found for today — did check-banners run?");
    process.exit(1);
  }
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));

  let overallOk = true;
  let cards = "";
  let tocItems = "";
  for (const [siteName, site] of Object.entries(report.sites)) {
    const homeDesktop = site.home?.desktop;
    const homeMobile = site.home?.mobile;
    const artDesktop = site.article?.desktop;
    const artMobile = site.article?.mobile;

    const siteFailed = [homeDesktop, homeMobile, artDesktop, artMobile].some(
      (e) => e && !e.ok
    );
    if (siteFailed) overallOk = false;

    const homeComparisons = compareBanners(homeDesktop, homeMobile);
    const artComparisons = compareBanners(artDesktop, artMobile);
    const overallSiteIcon =
      homeComparisons.some((c) => c.cls === "mismatch") ||
      artComparisons.some((c) => c.cls === "mismatch")
        ? "❌"
        : homeComparisons.some((c) => c.cls === "ok") ||
          artComparisons.some((c) => c.cls === "ok")
        ? "✅"
        : "—";

    const slug = slugify(siteName);
    tocItems += `<li><a href="#${slug}">${overallSiteIcon} ${siteName}</a></li>`;

    cards += `
      <section class="site" id="${slug}">
        <h2>${overallSiteIcon} ${siteName} <a href="${site.url}" target="_blank">${site.url}</a></h2>
        <h3>Homepage</h3>
        <div class="banners">${homeComparisons.map((c) => c.html).join(" ")}</div>
        <div class="row">
          ${renderDevice(homeDesktop, siteName, "home desktop")}
          ${renderDevice(homeMobile, siteName, "home mobile")}
        </div>
        <h3>Latest article ${site.articleUrl ? `— <a href="${site.articleUrl}" target="_blank">${site.articleUrl}</a>` : "(not found)"}</h3>
        <div class="banners">${artComparisons.map((c) => c.html).join(" ")}</div>
        <div class="row">
          ${renderDevice(artDesktop, siteName, "article desktop")}
          ${renderDevice(artMobile, siteName, "article mobile")}
        </div>
      </section>`;
  }

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>Banner check — ${today}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; background: #f7f7f8; color: #1a1a1a; }
  h1 { margin-bottom: 4px; }
  .sub { color: #666; margin-bottom: 24px; }
  .site { background: #fff; border: 1px solid #e2e2e2; border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
  .site h2 { margin-top: 0; font-size: 18px; }
  .site h2 a { font-size: 13px; font-weight: normal; margin-left: 8px; color: #4a6cf7; }
  .site h3 { font-size: 14px; color: #444; margin: 16px 0 8px; }
  .row { display: flex; gap: 16px; flex-wrap: wrap; }
  .shot { flex: 1 1 380px; max-width: 460px; border: 1px solid #eee; border-radius: 6px; overflow: hidden; background: #fafafa; }
  .shot img { width: 100%; display: block; border-bottom: 1px solid #eee; }
  .shot img.in-article-crop { border-top: 2px dashed #ccc; }
  .shot-caption { margin: 0; padding: 6px 10px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; color: #666; background: #f0f0f0; }
  .shot.error { padding: 40px 16px; text-align: center; color: #b00020; }
  .banners { padding: 4px 0 12px; font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px; }
  .chk { padding: 2px 6px; border-radius: 4px; background: #f0f0f0; }
  .chk.mismatch { background: #fde8e8; color: #a00; }
  .chk.none { background: #f0f0f0; color: #999; }
  .chk.ok { background: #e8f7ec; color: #1a7a3a; }
  .chk.unknown { background: #fff8e1; color: #8a6d00; }
  .index-link { margin-bottom: 20px; display: inline-block; }
  .layout { display: flex; gap: 24px; align-items: flex-start; }
  .toc { flex: 0 0 220px; position: sticky; top: 24px; background: #fff; border: 1px solid #e2e2e2; border-radius: 8px; padding: 12px 16px; max-height: calc(100vh - 48px); overflow-y: auto; }
  .toc h2 { font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: #888; margin: 0 0 8px; }
  .toc ul { list-style: none; margin: 0; padding: 0; }
  .toc li { margin: 0 0 6px; }
  .toc a { color: #1a1a1a; text-decoration: none; font-size: 13px; }
  .toc a:hover { color: #4a6cf7; text-decoration: underline; }
  .main { flex: 1 1 auto; min-width: 0; }
  /* Sidebar ToC is desktop-only — hidden on narrow/mobile screens */
  @media (max-width: 900px) {
    .toc { display: none; }
    .layout { display: block; }
  }
</style>
</head>
<body>
  <h1>Banner check — ${today}</h1>
  <p class="sub">Homepage + latest article, desktop &amp; mobile, across all ${Object.keys(report.sites).length} FNN sites.</p>
  <div class="layout">
    <nav class="toc">
      <h2>Sites</h2>
      <ul>${tocItems}</ul>
    </nav>
    <div class="main">${cards}</div>
  </div>
</body>
</html>`;

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
  console.log(`Gallery written to ${OUT_DIR}/index.html`);

  // --- Prune folders older than RETENTION_DAYS ---
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  if (fs.existsSync(ROOT)) {
    for (const entry of fs.readdirSync(ROOT)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(entry)) continue;
      const entryDate = new Date(entry + "T00:00:00Z").getTime();
      if (entryDate < cutoff) {
        fs.rmSync(path.join(ROOT, entry), { recursive: true, force: true });
        console.log(`Pruned old folder: ${entry}`);
      }
    }
  }

  // --- Root index.html: redirect / link list to the latest run ---
  const allDates = fs
    .readdirSync(ROOT)
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort()
    .reverse();
  const listHtml = `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<meta http-equiv="refresh" content="0; url=${today}/index.html">
<title>Banner checks</title></head>
<body style="font-family:system-ui,sans-serif;padding:24px;">
<p>Redirecting to latest run (${today})…</p>
<ul>${allDates.map((d) => `<li><a href="${d}/index.html">${d}</a></li>`).join("")}</ul>
</body></html>`;
  fs.writeFileSync(path.join(ROOT, "index.html"), listHtml);

  // Block crawlers from this whole banner-checks/ subtree. GitHub Pages
  // serves this at /<repo>/banner-checks/robots.txt — combined with the
  // noindex meta tags above, this keeps the screenshots out of search
  // results even though the URL itself is still technically public.
  fs.writeFileSync(
    path.join(ROOT, "robots.txt"),
    "User-agent: *\nDisallow: /\n"
  );

  // Emit a small summary file for the Chat notification step
  fs.writeFileSync(
    path.join(OUT_DIR, "summary.json"),
    JSON.stringify({ date: today, overallOk }, null, 2)
  );
}

main();
