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

// Pages taller than this (CSS px) use Playwright's fullPage mode instead.
const MAX_FULL_HEIGHT = 9000;

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

const IFRAME_SEL = 'iframe[id^="JotFormIFrame"], iframe[src*="jotform.com"]';
const INLINE_SEL = "form.jotform-form";
const FIELDS = "input:visible, textarea:visible, select:visible";
const FRAME_CLIP_TOLERANCE_PX = 40;
const SUBMIT = 'button[type="submit"], input[type="submit"], .form-submit-button';

/** The element that holds the form: the Jotform iframe, or the inline form. */
function formElement(page, embed) {
  return embed === "inline" ? page.locator(INLINE_SEL).first() : page.locator(IFRAME_SEL).first();
}

/**
 * Inspect the Jotform. Most pages embed it as an iframe, but some (older
 * Singapore reports) print the form straight into the page. Checks: form
 * present, fields visible, fits the mobile screen, no sideways scroll.
 */
async function inspectForm(page) {
  const result = {
    embed: null, // "iframe" | "inline"
    embedFound: false,
    formRendered: false,
    visibleFields: 0,
    fitsViewport: null,
    pageOverflowX: false,
    box: null,
    submitVisible: null,
    frameContentHeight: null,
    frameHeight: null,
    problems: [],
  };

  try {
    await page.locator(`${IFRAME_SEL}, ${INLINE_SEL}`).first().waitFor({ state: "attached", timeout: FORM_READY_TIMEOUT_MS });
    result.embedFound = true;
  } catch {
    result.problems.push("Jotform form never appeared on the page");
    return result;
  }
  result.embed = (await page.locator(IFRAME_SEL).count()) > 0 ? "iframe" : "inline";

  const el = formElement(page, result.embed);
  await el.scrollIntoViewIfNeeded().catch(() => {});

  // Give the form extra time to finish rendering after the page loaded.
  await page.waitForTimeout(FORM_EXTRA_WAIT_MS);

  const fields =
    result.embed === "iframe"
      ? page.frameLocator(IFRAME_SEL).first().locator(`form ${FIELDS.split(", ").join(", form ")}`)
      : page.locator(`${INLINE_SEL} ${FIELDS.split(", ").join(`, ${INLINE_SEL} `)}`);

  try {
    await fields.first().waitFor({ state: "visible", timeout: FORM_READY_TIMEOUT_MS });
    result.formRendered = true;
  } catch {
    result.problems.push("Form fields did not render");
  }

  if (result.formRendered) {
    result.visibleFields = await fields.count().catch(() => 0);
    if (result.visibleFields < MIN_VISIBLE_FIELDS) {
      result.problems.push(`Only ${result.visibleFields} visible field(s) in the form`);
    }
  }

  const box = await el.boundingBox();
  result.box = box && {
    x: Math.round(box.x), y: Math.round(box.y),
    width: Math.round(box.width), height: Math.round(box.height),
  };
  if (!box || box.width < 200 || box.height < 150) {
    result.problems.push("Form is collapsed or too small");
  }
  if (box) {
    result.fitsViewport = box.x >= -1 && box.x + box.width <= MOBILE_VIEWPORT.width + 1;
    if (!result.fitsViewport) result.problems.push("Form is wider than the mobile screen");
  }

  // Is the WHOLE form visible, down to the submit button? A form can render
  // fine but be cut off (iframe shorter than its content, or a wrapper that
  // hides the bottom), leaving the submit button out of reach.
  if (result.formRendered) {
    if (result.embed === "iframe") {
      const dims = await page
        .frameLocator(IFRAME_SEL)
        .first()
        .locator("html")
        .evaluate(() => ({ sh: document.documentElement.scrollHeight, ih: window.innerHeight }))
        .catch(() => null);
      if (dims) {
        result.frameContentHeight = dims.sh;
        result.frameHeight = dims.ih;
        // Jotform frames normally overshoot by ~16px of padding; only flag a real clip.
        if (dims.sh > dims.ih + FRAME_CLIP_TOLERANCE_PX) {
          result.problems.push(`Form is cut off: it is ${dims.sh}px tall but the frame shows only ${dims.ih}px`);
        }
      }
    }

    const scope = result.embed === "iframe" ? page.frameLocator(IFRAME_SEL).first() : page.locator(INLINE_SEL).first();
    const submit = scope.locator(SUBMIT).first();
    if ((await submit.count().catch(() => 0)) === 0) {
      result.submitVisible = false;
      result.problems.push("Submit button not found in the form");
    } else {
      // Bring the button to the middle of the screen, then check that it is
      // really what a visitor would see and tap at that spot.
      await submit.evaluate((e) => e.scrollIntoView({ block: "center" })).catch(() => {});
      await page.waitForTimeout(800);
      const sb = await submit.boundingBox().catch(() => null);
      let visible = !!sb && sb.width > 20 && sb.height > 10 && (await submit.isVisible().catch(() => false));
      if (visible) {
        const cx = sb.x + sb.width / 2;
        const cy = sb.y + sb.height / 2;
        const hit = await page.evaluate(
          ([x, y, embed]) => {
            const e = document.elementFromPoint(x, y);
            if (!e) return false;
            if (embed === "iframe") return e.tagName === "IFRAME";
            return !!e.closest("form.jotform-form");
          },
          [cx, cy, result.embed]
        );
        visible = hit && cy > 0 && cy < MOBILE_VIEWPORT.height;
      }
      result.submitVisible = visible;
      if (!visible) result.problems.push("Submit button is hidden or cut off");
    }
  }

  result.pageOverflowX = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  );
  if (result.pageOverflowX) result.problems.push("Page scrolls horizontally on mobile");

  return result;
}

async function checkPage(browser, target) {
  const fileBase = slug(target.name);
  const out = { name: target.name, url: target.url, ok: false, fullFile: null, form: null, error: null };

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

      // Whole page, mobile. Playwright's fullPage mode leaves the Jotform
      // iframe blank (it doesn't repaint while the window is resized for the
      // capture), so instead grow the real viewport to the page height, let
      // the iframe repaint, and take a normal screenshot.
      out.fullFile = `${fileBase}-full.png`;
      const pageHeight = await page.evaluate(() => Math.ceil(document.documentElement.scrollHeight));
      if (pageHeight <= MAX_FULL_HEIGHT) {
        await page.setViewportSize({ width: MOBILE_VIEWPORT.width, height: pageHeight });
        await page.waitForTimeout(5000); // let the form repaint at the new size
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(OUT_DIR, out.fullFile), timeout: 90000 });
      } else {
        // Unusually tall page: fall back to fullPage (the form close-up still shows the form).
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(1000);
        await page.screenshot({ path: path.join(OUT_DIR, out.fullFile), fullPage: true, timeout: 90000 });
      }

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
  // Three columns on desktop so fewer scrolls are needed; one column on narrow screens.
  // Problem pages first, so they are the first thing in the gallery.
  const ordered = [...report.pages].sort((a, b) => (a.status === "ok") - (b.status === "ok"));
  const cards = ordered
    .map(
      (p) => `<section class="${p.status === "ok" ? "ok" : "problem"}">
  <h2>${p.status === "ok" ? "✅" : "⚠️"} ${esc(p.name)}</h2>
  <p class="url"><a href="${esc(p.url)}">${esc(p.url)}</a></p>
  ${p.problems.length ? `<ul class="bad">${p.problems.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="good">Form displayed correctly on mobile.</p>'}
  ${p.fullFile ? `<a href="${esc(p.fullFile)}"><img src="${esc(p.fullFile)}" loading="lazy" alt="${esc(p.name)} full page, mobile"></a>` : ""}
</section>`
    )
    .join("\n");
  const okCount = report.pages.filter((p) => p.status === "ok").length;
  fs.writeFileSync(
    path.join(OUT_DIR, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow, noarchive, nosnippet">
<title>Jotform mobile check ${today}</title>
<style>
body{font-family:system-ui,sans-serif;margin:20px}
h1{margin:0 0 4px}.summary{margin:0 0 16px;color:#444}
.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:20px;align-items:start}
section{border:1px solid #ddd;border-radius:8px;padding:12px;background:#fff}
section.problem{border-color:#b00020}
h2{font-size:16px;margin:0 0 4px}.url{margin:0 0 6px;font-size:12px;word-break:break-all}
img{display:block;width:100%;height:auto;border:1px solid #ccc;margin-top:8px}
.bad{color:#b00020;margin:4px 0 0;padding-left:18px}.good{color:#1a7f37;margin:4px 0 0}
@media (max-width:900px){.grid{grid-template-columns:1fr}}
</style></head><body>
<h1>Jotform mobile check, ${today}</h1>
<p class="summary">${okCount} of ${report.pages.length} pages OK. Click a screenshot to open it full size.</p>
<div class="grid">
${cards}
</div></body></html>`
  );

  console.log(`\nDone. Output in ${OUT_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
