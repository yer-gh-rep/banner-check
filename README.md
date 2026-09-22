# FNN Banner Check

Automated banner QA for the 12 Fintech News Network sites. Every 2 days (or
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
   to run every 2 days at 09:00 UTC. Adjust the `cron` line if you want a
   different time.

That's it. From here on, everything runs in GitHub's cloud — nobody needs
Node, Playwright, or a terminal on their own machine.

## How your colleague uses it

- **Every 2 days**, a Google Chat message shows up with a ✅ or ⚠️ summary
  and a link. She opens the link, sees a grid of screenshots per site
  (homepage + latest article, desktop + mobile), each tagged with which
  banner placements were found and rendered.
- **To run it early** (e.g. right after a banner change), she goes to the
  repo's **Actions** tab → **Banner Check** → **Run workflow** button. No
  code, no terminal.
- **Old screenshots** older than 14 days are deleted automatically on every
  run — nothing to clean up manually.

## What gets checked, per page

| Placement | Selector |
|---|---|
| Top banner (above header) | `.ad-banner-a`, `.ad-banner-a-mobile` |
| In-content banner (above Recent News / above article featured image) | `.ad-banner` |
| Sidebar ad widgets (Google Ad Manager) | `[id^="div-gpt-ad-"]` |

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

## Files

- `scripts/sites.js` — the 12 site URLs and banner selectors to check
- `scripts/check-banners.js` — Playwright script: screenshots + presence checks
- `scripts/build-gallery.js` — builds the HTML gallery + prunes old runs
- `scripts/notify-chat.js` — posts the summary to Google Chat
- `.github/workflows/banner-check.yml` — the schedule + manual trigger
