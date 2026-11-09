import { chromium, devices } from "playwright";
import fs from "node:fs";
import path from "node:path";
import {
  JOTFORM_PAGES,
  MOBILE_VIEWPORT,
  FORM_EXTRA_WAIT_MS,
  FORM_READY_TIMEOUT_MS,
  MIN_VISIBLE_FIELDS,
} from "./jotform-pages.js";

const today = new Date().toISOString().slice(0, 10);
const OUT_DIR = path.join("jotform-checks", today);
fs.mkdirSync(OUT_DIR, { recursive: true });

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

/** Scroll through the page so lazy content (incl. the form) gets triggered. */
async function scrollThroughPage(page) {
  await page.evaluate(async () => {
    const step = Math.max(300, Math.floor(window.innerHeight * 0.8));
    let last = -1;
    while (document.scrollingElement.scrollTop !== last) {
      last = document.scrollingElement.scrollTop;
      window.scrollBy(0, step);
      await new Promise((r) => setTimeout(r, 350));
    }
  });
}

/**
 * Inspect the Jotform: iframe present, form rendered inside it, fields
 * visible, no horizontal overflow, iframe fits within the mobile viewport.
 */
async function inspectForm(page) {
  const result = {
    iframeFound: false,
    formRendered: false,
    visibleFields: 0,
    fitsViewport: null,
    pageOverflowX: false,
    iframeBox: null,
    problems: [],
  };

  const iframeEl = page.locator('iframe[id^="JotFormIFrame"], iframe[src*="jotform.com"]').first();
  try {
    await iframeEl.waitFor({ state: "attached", timeout: FORM_READY_TIMEOUT_MS });
    result.iframeFound = true;
  } catch {
    result.problems.push("Jotform iframe never appeared on the page");
    return result;
  }

  await iframeEl.scrollIntoViewIfNeeded().catch(() => {});

  // Give the form extra time to finish rendering after the page loaded.
  await page.waitForTimeout(FORM_EXTRA_WAIT_MS);

  const frame = page.frameLocator('iframe[id^="JotFormIFrame"], iframe[src*="jotform.com"]').first();
  try {
    await frame
      .locator("form input:visible, form textarea:visible, form select:visible")
      .first()
      .waitFor({ state: "visible", timeout: FORM_READY_TIMEOUT_MS });
    result.formRendered = true;
  } catch {
    result.problems.push("Form fields did not render inside the iframe");
  }

  if (result.formRendered) {
    result.visibleFields = await frame
      .locator("form input:visible, form textarea:visible, form select:visible")
      .count()
      .catch(() => 0);
    if (result.visibleFields < MIN_VISIBLE_FIELDS) {
      result.problems.push(`Only ${result.visibleFields} visible field(s) in the form`);
    }
  }

  const box = await iframeEl.boundingBox();
  result.iframeBox = box && {
    x: Math.round(box.x), y: Math.round(box.y),
    width: Math.round(box.width), height: Math.round(box.height),
  };
  if (!box || box.width < 200 || box.height < 150) {
    result.problems.push("Iframe is collapsed or too small");
  }
  if (box) {
    result.fitsViewport = box.x >= -1 && box.x + box.width <= MOBILE_VIEWPORT.width + 1;
    if (!result.fitsViewport) result.problems.push("Form is wider than the mobile screen");
  }

  result.pageOverflowX = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  if (result.pageOverflowX) result.problems.push("Page scrolls horizontally on mobile");

  return result;
}

async function checkPage(browser, target) {
  const fileBase = slug(target.name);
  const out = { name: target.name, url: target.url, ok: false, fullFile: null, formFile: null, form: null, error: null };

  for (let attempt = 1; attempt <= 2 && !out.ok; attempt++) {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: MOBILE_VIEWPORT,
    });
    const page = await context.newPage();
    try {
      await page.goto(target.url, { waitUntil: "domcontentloaded", timeout: 45000 });
      await page.waitForLoadState("load", { timeout: 45000 }).catch(() => {});
      await page.addStyleTag({ content: "* { overflow-anchor: none !important; }" });
      await page.waitForTimeout(3000);
      await scrollThroughPage(page);

      out.form = await inspectForm(page);

      // Form close-up (viewport screenshot centred on the form)
      const iframeEl = page.locator('iframe[id^="JotFormIFrame"], iframe[src*="jotform.com"]').first();
      if (out.form.iframeFound) {
        out.formFile = `${fileBase}-form.png`;
        await iframeEl.screenshot({ path: path.join(OUT_DIR, out.formFile), timeout: 60000 }).catch(() => {
          out.formFile = null;
        });
      }

      // Whole page, mobile. Go back to top first so sticky headers sit normally.
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(1000);
      out.fullFile = `${fileBase}-full.png`;
      await page.screenshot({ path: path.join(OUT_DIR, out.fullFile), fullPage: true, timeout: 90000 });

      out.ok = true;
    } catch (err) {
      out.error = String(err);
      if (attempt === 1) console.log(`  retrying ${target.name}…`);
    } finally {
      await context.close();
    }
  }
  return out;
}

async function main() {
  const browser = await chromium.launch();
  const report = { date: today, pages: [] };

  for (const target of JOTFORM_PAGES) {
    console.log(`\n${target.name} (${target.url})`);
    const r = await checkPage(browser, target);
    const problems = r.ok ? r.form?.problems ?? [] : [`Capture failed: ${r.error}`];
    r.status = r.ok && problems.length === 0 ? "ok" : "problem";
    r.problems = problems;
    console.log(`  ${r.status}${problems.length ? ": " + problems.join("; ") : ""}`);
    report.pages.push(r);
  }
  await browser.close();

  report.overallOk = report.pages.every((p) => p.status === "ok");
  fs.writeFileSync(path.join(OUT_DIR, "report.json"), JSON.stringify(report, null, 2));

  // Simple gallery
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const cards = report.pages
    .map(
      (p) => `<section>
  <h2>${p.status === "ok" ? "✅" : "⚠️"} ${esc(p.name)}</h2>
  <p><a href="${esc(p.url)}">${esc(p.url)}</a></p>
  ${p.problems.length ? `<ul class="bad">${p.problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "<p class=\"good\">Form displayed correctly on mobile.</p>"}
  <div class="row">
    ${p.formFile ? `<figure><img src="${esc(p.formFile)}"><figcaption>Form</figcaption></figure>` : ""}
    ${p.fullFile ? `<figure><img src="${esc(p.fullFile)}"><figcaption>Full page (mobile)</figcaption></figure>` : ""}
  </div>
</section>`
    )
    .join("\n");
  fs.writeFileSync(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>Jotform mobile check ${today}</title>
<style>body{font-family:system-ui,sans-serif;margin:24px;max-width:1100px}section{border-top:1px solid #ddd;padding:16px 0}
.row{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap}figure{margin:0}img{max-width:390px;border:1px solid #ccc}
.bad{color:#b00020}.good{color:#1a7f37}</style></head><body>
<h1>Jotform mobile check, ${today}</h1>${cards}</body></html>`
  );

  console.log(`\nDone. Output in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
