# FNN Banner Check

Automated banner QA for the 12 Fintech News Network sites. Every Monday,
Wednesday and Friday morning (or
on demand), it screenshots the homepage and latest article on each site —
checks that the top and in-content banners actually rendered, captures a
full desktop screenshot (including the sidebar, so you can also see
webinar/report widgets etc.) and a cropped mobile screenshot of the main
banners, publishes a gallery page, and posts a summary + link to Google
Chat. No installs needed on anyone's machine.

## One-time setup (~10 minutes)

1. **Create a new GitHub repo** (private is fine) and push this folder to it.

2. **Enable GitHub Pages**
   Repo → Settings → Pages → Build and deployment → Source: **Deploy from a
   branch** → Branch: `gh-pages` / `/ (root)`. (The workflow creates the
   `gh-pages` branch automatically on its first run — just make sure Pages
   is pointed at it once that first run has happened.)

   Your gallery will then be reachable at:
   `https://<your-org-or-username>.github.io/<repo-name>/banner-checks/`

3. **Add two repo secrets**
   Repo → Settings → Secrets and variables → Actions → New repository secret:
   - `GCHAT_WEBHOOK_URL` — your Google Chat incoming webhook URL
   - `PAGES_BASE_URL` — `https://<your-org-or-username>.github.io/<repo-name>/banner-checks`
     (no trailing slash)

4. **Check the schedule** in `.github/workflows/banner-check.yml` — it's set
   to run Mon/Wed/Fri at 09:00 Singapore time (01:00 UTC). Adjust the `cron`
   line if you want a
   different time.

That's it. From here on, everything runs in GitHub's cloud — nobody needs
Node, Playwright, or a terminal on their own machine.

## How your colleague uses it

- **Every Monday, Wednesday, and Friday morning**, a Google Chat message shows up with a ✅ or ⚠️ summary
  and a link. Your colleague opens the link and sees a grid of screenshots
  per site (homepage + latest article, desktop + mobile), each tagged with
  which banner placements were found and rendered.
- **To run it early** (e.g. right after a banner change), your colleague
  goes to the repo's **Actions** tab → **Banner Check** → **Run workflow**
  button. No code, no terminal.
- **Old screenshots** older than 14 days are deleted automatically on every
  run — nothing to clean up manually.

## What gets checked, per page

| Placement | Selector |
|---|---|
| Top banner (above header) | `.ad-banner-a`, `.ad-banner-a-mobile` |
| In-content banner (above Recent News / above article featured image) | `.ad-banner` |
| In-article banner (Advanced Ads, between paragraphs — articles only) | `.fintech-entity-placement` |

**Desktop** screenshots are full page, uncropped — this includes the
sidebar as-is, since that's where webinar signups, report downloads, etc.
live, and you already know which Google Ad Manager slots should or
shouldn't appear there, so there's no separate automated check for those.

**Mobile** screenshots are just the first screen (viewport-only) — the same
on every page. On the homepage specifically, this is captured with no
scrolling at all: the page loads, settles briefly, and is screenshotted
exactly as it first appears. Everywhere else (article pages), the page is
scrolled through fully first (then back to the top) so lazy-loaded
top/in-content banners have already rendered by the time the first-screen
shot is taken. The in-article (Advanced Ads) placement won't be in this
first-screen shot since it sits further down mid-post; instead, on article
pages, it gets its own dedicated close-up screenshot(s) — one per placement
found — shown right below the main screenshot, each labeled.

## Reading the ✅ / ❌ / — icons

Each banner placement is checked separately on **desktop** and **mobile**
(each in its own real browser at that exact screen size), then compared:

- **✅ green** — showing correctly on both desktop and mobile.
- **❌ red** — a real mismatch: showing on one device but missing on the
  other. This is the one worth investigating.
- **— grey** — not present on either device. This isn't an error, it just
  means that placement isn't configured for that page (e.g. many sites
  don't use every banner slot on every page) — so it's not flagged red.
- **❔ yellow** — the screenshot capture itself failed for that page, so
  banner status is unknown rather than a "not configured" — check
  `report.json` for the actual error.

These were found by inspecting fintechnews.sg's live markup. All 12 sites
share the same WordPress theme, so they should mostly match — but if a
banner shows as ❌ on a site where you know it's actually fine, that site's
markup may differ slightly and the selector in `scripts/sites.js` may need
a small tweak for that one site.

## Local testing (optional, for you — not required for her)

```bash
npm install
npx playwright install --with-deps chromium
npm run check      # takes screenshots into banner-checks/<today>/
npm run gallery    # builds banner-checks/<today>/index.html
```

## Keeping this out of Google

Every generated page includes `<meta name="robots" content="noindex, nofollow, noarchive, nosnippet">`,
and a `robots.txt` under `banner-checks/` disallows crawling of the whole
gallery. Together these keep the screenshots out of Google's index and out
of "site:" search results.

**Important caveat:** this stops it from being *indexed*, not from being
*publicly reachable*. GitHub Pages sites are public URLs by default — anyone
with the exact link can open it, even off a private repo, unless your GitHub
plan supports restricting Pages visibility (some paid plans/Enterprise). If
you need the gallery to require a login rather than just be unlisted, that's
a separate setting under Settings → Pages → Visibility — let me know if that
matters and I can adjust the approach instead (e.g. a private workflow
artifact download rather than a public Pages site).

## Files

- `scripts/sites.js` — the 12 site URLs and banner selectors to check
- `scripts/check-banners.js` — Playwright script: screenshots + presence checks
- `scripts/build-gallery.js` — builds the HTML gallery + prunes old runs
- `scripts/notify-chat.js` — posts the summary to Google Chat
- `.github/workflows/banner-check.yml` — the schedule + manual trigger
