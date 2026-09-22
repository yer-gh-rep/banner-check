import fs from "node:fs";
import path from "node:path";

const today = new Date().toISOString().slice(0, 10);
const summaryPath = path.join("banner-checks", today, "summary.json");
const reportPath = path.join("banner-checks", today, "report.json");

const webhookUrl = process.env.GCHAT_WEBHOOK_URL;
const pagesBaseUrl = process.env.PAGES_BASE_URL; // e.g. https://org.github.io/repo/banner-checks

if (!webhookUrl) {
  console.error("GCHAT_WEBHOOK_URL is not set — skipping notification.");
  process.exit(0);
}
if (!pagesBaseUrl) {
  console.error("PAGES_BASE_URL is not set — skipping notification.");
  process.exit(0);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const siteCount = Object.keys(report.sites).length;
const galleryUrl = `${pagesBaseUrl.replace(/\/$/, "")}/${today}/index.html`;

const text = summary.overallOk
  ? `✅ Banner check ${today}: all captures succeeded across ${siteCount} sites.\n${galleryUrl}`
  : `⚠️ Banner check ${today}: one or more captures failed — open the gallery to see which.\n${galleryUrl}`;

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
