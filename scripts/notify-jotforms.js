import fs from "node:fs";
import path from "node:path";

const today = new Date().toISOString().slice(0, 10);
const report = JSON.parse(fs.readFileSync(path.join("jotform-checks", today, "report.json"), "utf8"));

const webhookUrl = process.env.GCHAT_WEBHOOK_URL;
const pagesBaseUrl = process.env.PAGES_BASE_URL; // .../banner-checks (same secret as the banner check)

if (!webhookUrl) {
  console.error("GCHAT_WEBHOOK_URL is not set, skipping notification.");
  process.exit(0);
}

// PAGES_BASE_URL ends in /banner-checks; the Jotform gallery lives next to it.
const base = pagesBaseUrl ? pagesBaseUrl.replace(/\/$/, "").replace(/\/banner-checks$/, "") : null;
const galleryUrl = base ? `${base}/jotform-checks/${today}/index.html` : null;

const total = report.pages.length;
const bad = report.pages.filter((p) => p.status !== "ok");

// Only report problems. If everything is fine, say so in one line.
let text;
if (bad.length === 0) {
  text = `✅ Jotform mobile check ${today}: all ${total} forms are displayed correctly on mobile.`;
} else {
  const lines = bad.map((p) => `⚠️ ${p.name}: ${p.problems.join("; ")}\n${p.url}`);
  text =
    `⚠️ Jotform mobile check ${today}: ${bad.length} of ${total} forms have problems\n\n` +
    lines.join("\n\n");
}
if (galleryUrl) text += `\n\nScreenshots: ${galleryUrl}`;

const res = await fetch(webhookUrl, {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=UTF-8" },
  body: JSON.stringify({ text }),
});
if (!res.ok) {
  console.error(`Chat webhook failed: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log("Posted summary to Google Chat.");
