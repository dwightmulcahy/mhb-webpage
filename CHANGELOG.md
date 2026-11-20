# Changelog

All notable changes. Versions follow [SemVer](https://semver.org); entries come from [Conventional Commits](https://www.conventionalcommits.org).
Full generated notes and Docker pull commands are on [GitHub Releases](https://github.com/dwightmulcahy/mhb-webpage/releases).

## [Unreleased]
### Added
- Announcements section under the hero, editable by staff (owners and editors) in `/admin` → **Announcements**: EN/ES text, type (news, important, special, schedule change), optional button link, and optional show-from / show-until dates.
- "More than beer" (Beer. Cider. Cocktails.) section is now editable in `/admin` → **Beer · Cider · Cocktails**: section headings and cards (EN/ES text, photo / logo / cocktail picture, photo description).
### Changed
- Home page: the Events section (and its nav/footer links) hides when there are no upcoming events; links to hidden New Release / Announcements sections hide too.
- Home page taplist: headings nest under "Current Taplist" (h3/h4) and the hours/phone strip is left out, since Visit and the footer already show it. The TV board is unchanged.
- Merch prices typed as a bare number (e.g. `2500`) show as colones (`₡2.500`).

## [1.2.3] — 2026-11-16
### Fixed
- Allow the Cloudflare Insights beacon in the CSP; fix color contrast and tap-target size (#3).

## [1.2.2] — 2026-11-16
### Fixed
- Admin: replace inline `onclick` handlers blocked by the CSP.
- Security: add CSP, HSTS, Permissions-Policy and COOP/CORP headers, a login rate limit, an upload signature check and `security.txt`.

## [1.2.1] — 2026-11-03
### Fixed
- Use `api.whatsapp.com` links instead of `wa.me`.
### Maintenance
- Remove the unused local release-notes script.

## [1.2.0] — 2026-11-03
### Added
- Mobile Tap "van in the shop" popup with editable funny messages.

## [1.1.0] — 2026-11-03
### Added
- Show version, commit and build date next to **Staff Admin**.
### CI
- Publish release images to ghcr.io; generate conventional release notes for manually tagged GitHub releases.

## [1.0.0]
- Initial release.

[Unreleased]: https://github.com/dwightmulcahy/mhb-webpage/compare/v1.2.3...HEAD
[1.2.3]: https://github.com/dwightmulcahy/mhb-webpage/compare/v1.2.2...v1.2.3
[1.2.2]: https://github.com/dwightmulcahy/mhb-webpage/compare/v1.2.1...v1.2.2
[1.2.1]: https://github.com/dwightmulcahy/mhb-webpage/compare/v1.2.0...v1.2.1
[1.2.0]: https://github.com/dwightmulcahy/mhb-webpage/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dwightmulcahy/mhb-webpage/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/dwightmulcahy/mhb-webpage/releases/tag/v1.0.0
