import fs from "node:fs";
import path from "node:path";
import { JOTFORM_RETENTION_DAYS } from "./jotform-pages.js";

const ROOT = "jotform-checks";
const cutoff = Date.now() - JOTFORM_RETENTION_DAYS * 86400000;
for (const d of fs.existsSync(ROOT) ? fs.readdirSync(ROOT) : []) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d).getTime() < cutoff) {
    fs.rmSync(path.join(ROOT, d), { recursive: true, force: true });
    console.log(`Pruned ${d}`);
  }
}
