# FNN Banner Check

Automated banner QA for the 12 Fintech News Network sites. Every Monday,
Wednesday and Friday morning (or
on demand), it screenshots the homepage and latest article on each site —
desktop and mobile — checks that the top banner, in-content banner, and
sidebar ad widgets actually rendered, publishes a gallery page, and posts a
summary + link to Google Chat. No installs needed on anyone's machine.

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
| Sidebar ad widgets (Google Ad Manager) | `[id^="div-gpt-ad-"]` |

Sidebar ads are lazy-loaded, so the script scrolls all the way through each
page first to trigger them before checking or screenshotting. Each
screenshot is then cropped to end just past the lowest banner placement
found on that page (top banner → in-content banner → sidebar) — so you get
one clean image per device per page, without it running on through the long
"Recent News" list of unrelated articles underneath.

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
