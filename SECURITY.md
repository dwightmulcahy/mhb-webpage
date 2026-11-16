# Security policy

## Supported versions
Only the latest release (the `latest` image on `ghcr.io/dwightmulcahy/mhb-webpage`) gets fixes.

## Reporting a vulnerability
Please **don't open a public issue**. Report privately through
[GitHub Security Advisories](https://github.com/dwightmulcahy/mhb-webpage/security/advisories/new),
or use the contact in the site's [`/.well-known/security.txt`](https://www.monkeyheadbrewing.com/.well-known/security.txt).

Include the URL, steps to reproduce and the impact. Expect an acknowledgement within a few days.

## Scope
- In scope: the Node server (`server.js`), the public site, `/admin`, `/board` and the Docker image.
- Out of scope: Cloudflare, the QNAP host, third-party links (WhatsApp, Google Maps, social networks).

## Hardening already in place
CSP with hashed inline scripts, HSTS, nosniff/frame/referrer/permissions headers, constant-time password check,
per-IP login rate limit, upload content-type + magic-byte check, atomic writes, non-root container.
