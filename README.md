# Monkey Head Brewing website

Node 22 server with no dependencies, packaged as a Docker image.

| URL | What |
|---|---|
| `/` and `/es` | Public site, English and Spanish, rendered on the server for search engines. The toggle in the nav switches between them. |
| `/board` | Full-screen chalkboard taplist for the taproom TV. Refreshes every 30 s; `?lang=es` for Spanish. |
| `/admin` | Staff editor with **Taplist**, **Events**, **Where to Find**, **Merch**, **New Release** and **Follow Us** tabs. Password is `ADMIN_PASSWORD`. |
| `/sitemap.xml`, `/robots.txt` | Generated automatically; submit the sitemap in Google Search Console. |

## Data (in `./data`, survives rebuilds)
- `taplist.json`: TapListBuilder format. Import/Export it from `/admin`.
- `events.json`: events. Past events are hidden automatically (Costa Rica time). The next one shows in the top banner.
- `places.json`: the "Where to Find Us" list.
- `merch.json`: merchandise items.
- `releases.json`: the NEW BEER RELEASE highlight (the first one marked "Show on site").
- `social.json`: "Follow us" links in the footer (also sent to Google as the brewery's profiles).
- `uploads/`: event posters uploaded from `/admin`.

To reset to the seed data, delete the matching file and restart the container.

## Settings
- `ADMIN_PASSWORD`: required for editing.
- `SITE_URL`: your public address, e.g. `https://monkeyheadbrewing.com`. Used for canonical links, the sitemap and social previews. If unset, the request's host is used.

## Deploy on QNAP
```sh
cp .env.example .env   # set ADMIN_PASSWORD
echo "$GHCR_PAT" | docker login ghcr.io -u dwightmulcahy --password-stdin   # once; classic PAT with read:packages
docker compose pull && docker compose up -d
```

Release images are published to `ghcr.io/dwightmulcahy/mhb-webpage` (`linux/amd64`, `linux/arm64`) by `.github/workflows/docker-release.yml` on every `v*.*.*` tag. Tags: `X.Y.Z`, `X.Y`, `X`, `latest`, `sha-<short>`. Pin a version with `MHB_TAG=1.2.3` in `.env`. To build locally instead: `docker compose up -d --build`.

The version, commit and build date show next to **Staff Admin** in `/admin` (also at `/api/version`). Release images get them automatically; local builds show "dev build" unless you pass them:
```sh
docker build --build-arg APP_VERSION=$(git describe --tags --always) \
  --build-arg GIT_SHA=$(git rev-parse HEAD) --build-arg BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ) -t mhb-web .
```
